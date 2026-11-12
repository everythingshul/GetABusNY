// Builds a real Excel workbook (.xlsx) with no libraries. Text is stored as Unicode, so Hebrew and any other language
// opens correctly in Excel, Numbers and Google Sheets (a CSV often shows Hebrew as gibberish).
//
//   buildXlsx([{ name: 'Invoices', cols: [{ h: 'Number' }, { h: 'Total', t: 'money' }, { h: 'Date', t: 'date' }], rows: [['INV-1001', 12.5, '2026-10-27']] }])
//
// Column types: text (default), money (number shown as 1,234.50), int, num, date ('YYYY-MM-DD'), datetime (milliseconds since 1970).
const enc = new TextEncoder();
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

const xmlText = (v) => String(v).replace(/[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const colName = (i) => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const STYLE = { head: 1, money: 2, date: 3, datetime: 4, int: 5, num: 0 };
const serial = (ms) => ms / 86400000 + 25569;

function cell(v, t, r) {
  if (v == null || v === '') return '';
  if (t === 'money' || t === 'int' || t === 'num') {
    const n = Number(v); if (!isFinite(n)) return `<c r="${r}" t="inlineStr"><is><t>${xmlText(v)}</t></is></c>`;
    return `<c r="${r}"${STYLE[t] ? ` s="${STYLE[t]}"` : ''}><v>${n}</v></c>`;
  }
  if (t === 'date') {
    const ms = Date.parse(String(v) + 'T00:00:00Z');
    return isNaN(ms) ? `<c r="${r}" t="inlineStr"><is><t>${xmlText(v)}</t></is></c>` : `<c r="${r}" s="${STYLE.date}"><v>${serial(ms)}</v></c>`;
  }
  if (t === 'datetime') {
    const ms = Number(v);
    return isFinite(ms) && ms > 0 ? `<c r="${r}" s="${STYLE.datetime}"><v>${serial(ms)}</v></c>` : '';
  }
  const s = String(v).slice(0, 32000);
  return `<c r="${r}" t="inlineStr"><is><t xml:space="preserve">${xmlText(s)}</t></is></c>`;
}

function sheetXml(sheet) {
  const cols = sheet.cols, rows = sheet.rows;
  const width = (c, i) => {
    if (c.w) return c.w;
    let m = String(c.h).length;
    for (let k = 0; k < Math.min(rows.length, 200); k++) { const l = String(rows[k][i] ?? '').split('\n')[0].length; if (l > m) m = l; }
    return Math.max(9, Math.min(60, m + 2));
  };
  let x = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"${sheet.rtl ? ' rightToLeft="1"' : ''}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>`;
  x += '<cols>' + cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${width(c, i)}" customWidth="1"/>`).join('') + '</cols><sheetData>';
  x += '<row r="1">' + cols.map((c, i) => `<c r="${colName(i)}1" s="${STYLE.head}" t="inlineStr"><is><t>${xmlText(c.h)}</t></is></c>`).join('') + '</row>';
  rows.forEach((row, ri) => {
    const r = ri + 2;
    x += `<row r="${r}">` + cols.map((c, i) => cell(row[i], c.t, colName(i) + r)).join('') + '</row>';
  });
  x += '</sheetData>';
  if (rows.length) x += `<autoFilter ref="A1:${colName(cols.length - 1)}${rows.length + 1}"/>`;
  return x + '</worksheet>';
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}">
<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE8F7"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/* ------------------------------------------------------------------ minimal zip (stored, no compression) */
let CRC = null;
const crc32 = (buf) => {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function zip(files) {
  const DATE = ((2024 - 1980) << 9) | (1 << 5) | 1;
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, DATE, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, nb.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nb, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, 0, true); ch.setUint16(14, DATE, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, nb.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nb);
    offset += 30 + nb.length + data.length;
  }
  const cdSize = central.reduce((a, p) => a + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

export function buildXlsx(sheets) {
  sheets = sheets.map((s, i) => ({ ...s, name: String(s.name || 'Sheet' + (i + 1)).replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31) }));
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xmlText(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STYLES],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ];
  return zip(files);
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
