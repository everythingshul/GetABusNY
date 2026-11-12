// Watermark: logo is burned into served photos, size is kept, results are cached, bad input never breaks serving.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-'));
process.env.DATA_DIR = dir;
const { mark, markedFile } = await import('../src/watermark.js');
const src = path.join(dir, 'in.jpg');
fs.writeFileSync(src, await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#2a5a9a' } }).jpeg().toBuffer());
const a = fs.readFileSync(src), b = await markedFile(src), c = await markedFile(src);
const mb = await sharp(b).metadata();
assert.equal(mb.width, 1600); assert.equal(mb.height, 900); assert.ok(!a.equals(b), 'image changed');
assert.ok(b.equals(c), 'second call comes from cache'); assert.ok(fs.readdirSync(path.join(dir, 'wm-cache')).length === 1);
// bottom-right corner now has light pixels (the plate), the opposite corner is untouched
const raw = await sharp(b).raw().toBuffer({ resolveWithObject: true });
const px = (x, y) => { const i = (y * raw.info.width + x) * raw.info.channels; return raw.data[i] + raw.data[i + 1] + raw.data[i + 2]; };
assert.ok(px(1250, 760) > 500, 'logo plate present at bottom right'); assert.ok(px(10, 10) < 400, 'top left untouched');
const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#336699' } }).png().toBuffer();
assert.ok(!(await mark(png, '.png')).equals(png)); assert.equal((await mark(Buffer.from('nope'), '.jpg')).toString(), 'nope');
fs.writeFileSync(path.join(process.env.TMPDIR || os.tmpdir(), 'wm-sample.jpg'), b);
console.log('Watermark checks passed.');
