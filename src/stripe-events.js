// Everything Stripe tells us. Kept apart from the route so it can be tested without HTTP.
import { one, insert, now, log } from './db.js';
import { recordPayment, recordAuthorization, markCaptured, markReleased, recalcInvoice } from './services.js';
import { notifyOwner, money } from './integrations.js';
import { saveCardFromSetup, saveCardFromPayment } from './cards.js';

export async function applyStripeEvent(ev) {
    const o = ev.data?.object || {};
    if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
      const iid = Number(o.metadata?.invoice_id);
      if (o.metadata?.mode === 'auth') { /* a card hold: money moves later, see payment_intent.* below */ }
      else if (o.mode === 'setup') { const cid = Number(o.metadata?.customer_id); if (cid && o.setup_intent) await saveCardFromSetup(cid, o.customer, o.setup_intent); }
      else if (o.payment_status === 'paid' && iid && one('SELECT 1 x FROM invoices WHERE id=?', iid)) {
        recordPayment(iid, { amount_cents: o.amount_total, method: 'card', stripe_session: o.id, stripe_pi: o.payment_intent, reference: o.payment_intent }, 'stripe');
        const cid = Number(o.metadata?.customer_id);
        if (o.metadata?.save_card === '1' && cid && o.payment_intent) await saveCardFromPayment(cid, o.customer, o.payment_intent);
      };
    } else if (ev.type === 'payment_intent.amount_capturable_updated') {
      const iid = Number(o.metadata?.invoice_id);
      if (o.metadata?.mode === 'auth' && iid && one('SELECT 1 x FROM invoices WHERE id=?', iid) && o.amount_capturable > 0) recordAuthorization(iid, { amount_cents: o.amount_capturable, stripe_pi: o.id });
    } else if (ev.type === 'payment_intent.succeeded') {
      // only card holds that were captured; normal checkout payments are recorded by checkout.session.completed
      const row = o.metadata?.mode === 'auth' ? one("SELECT * FROM payments WHERE stripe_pi=? AND method='card_auth'", o.id) : null;
      if (row) markCaptured(row, o.amount_received || row.amount_cents);
    } else if (ev.type === 'payment_intent.canceled') {
      const row = one("SELECT * FROM payments WHERE stripe_pi=? AND method='card_auth'", o.id);
      if (row) markReleased(row, o.cancellation_reason === 'automatic' ? 'expired' : 'released');
    } else if (ev.type === 'payment_intent.payment_failed') {
      const iid = Number(o.metadata?.invoice_id);
      if (iid) { log('stripe', 'payment.failed', 'invoice', iid, o.last_payment_error?.message || 'declined'); notifyOwner('A card payment failed', `Invoice ${o.metadata?.invoice_number || iid}: ${o.last_payment_error?.message || 'the card was declined'}.`, 'payment_failed').catch(() => {}); }
    } else if (ev.type === 'charge.dispute.created') {
      const p = one('SELECT * FROM payments WHERE stripe_pi=? LIMIT 1', o.payment_intent);
      log('stripe', 'payment.dispute', 'invoice', p?.invoice_id ?? null, `${money(o.amount)} ${o.reason || ''}`);
      notifyOwner('Chargeback opened', `A customer disputed ${money(o.amount)} (${o.reason || 'no reason given'}). Reply with evidence in your Stripe dashboard before ${o.evidence_details?.due_by ? new Date(o.evidence_details.due_by * 1000).toDateString() : 'the deadline'}. Signed agreement and trip records are in the admin.`, 'chargeback').catch(() => {});
    } else if (ev.type === 'charge.refunded') {
      const p = one("SELECT * FROM payments WHERE stripe_pi=? AND amount_cents>0 AND status='succeeded'", o.payment_intent);
      for (const rf of o.refunds?.data || []) {
        if (p && !one('SELECT 1 x FROM payments WHERE stripe_session=?', rf.id)) {
          insert('payments', { invoice_id: p.invoice_id, amount_cents: -rf.amount, method: 'refund', reference: rf.id, stripe_session: rf.id, stripe_pi: o.payment_intent, status: 'succeeded', created_at: now() });
          recalcInvoice(p.invoice_id); log('stripe', 'payment.refunded', 'invoice', p.invoice_id, money(rf.amount));
        }
      }
    }
}
