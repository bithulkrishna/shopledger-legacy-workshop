const test = require('node:test');
const assert = require('node:assert/strict');

const invoice = require('../lib/invoice');
const orders = require('../lib/orders');
const pricing = require('../lib/pricing');
const reports = require('../lib/reports');
const tax = require('../lib/tax');

function createOrder(items, coupon) {
  const totals = pricing.computeTotals(items, coupon || '');
  const db = { nextOrderId: 1001, orders: [] };
  const order = orders.add(db, {
    date: '2026-11-21',
    customer: 'Test Customer',
    items,
    coupon: coupon || '',
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: totals.tax,
    total: totals.total
  });
  return { db, order, totals };
}

test('invoice figures use the same HSN slab rate as the billed order', () => {
  const item = {
    id: 1,
    name: 'Rice',
    sku: 'RICE-1',
    hsn: '1006',
    price: 100,
    qty: 1
  };

  assert.equal(tax.getRateForItem(item), 0.05);
  const { order, totals } = createOrder([item]);
  const figures = invoice.computeInvoiceFigures(order);

  assert.equal(totals.tax, 5);
  assert.equal(totals.total, 105);
  assert.equal(order.tax, 5);
  assert.equal(order.total, 105);
  assert.equal(figures.rows[0].gstPercent, 5);
  assert.equal(figures.rows[0].lineTax, 5);
  assert.equal(figures.tax, 5);
  assert.equal(figures.cgst, 2.5);
  assert.equal(figures.sgst, 2.5);
  assert.equal(figures.total, 105);
});

test('invoice and billed order apply the same coupon discount and GST', () => {
  const item = {
    id: 2,
    name: 'Rice sack',
    sku: 'RICE-10',
    hsn: '1006',
    price: 1000,
    qty: 1
  };
  const { order, totals } = createOrder([item], 'WELCOME');
  const figures = invoice.computeInvoiceFigures(order);

  assert.equal(totals.subtotal, 1000);
  assert.equal(totals.discount, 50);
  assert.equal(totals.tax, 47.5);
  assert.equal(totals.total, 997.5);
  assert.equal(figures.discount, 50);
  assert.equal(figures.tax, 47.5);
  assert.equal(figures.total, 997.5);
});

test('GST reconciliation reports a match when invoice figures equal the billed order', () => {
  const item = {
    id: 3,
    name: 'Rice',
    sku: 'RICE-1',
    hsn: '1006',
    price: 100,
    qty: 1
  };
  const { db, order } = createOrder([item]);
  const reconciliation = reports.getGstReconciliation(db);

  assert.equal(order.total, 105);
  assert.equal(reconciliation.totalChecked, 1);
  assert.equal(reconciliation.mismatchCount, 0);
  assert.equal(reconciliation.totalDelta, 0);
  assert.deepEqual(reconciliation.rows[0], {
    orderId: 1001,
    date: '2026-11-21',
    customer: 'Test Customer',
    coupon: '',
    ledgerSubtotal: 100,
    ledgerDiscount: 0,
    ledgerTax: 5,
    ledgerTotal: 105,
    invoiceDiscount: 0,
    invoiceTax: 5,
    invoiceTotal: 105,
    delta: 0,
    matched: true
  });
});

test('rendered invoice shows billed HSN GST and no mismatch notice when figures match', () => {
  const item = {
    id: 4,
    name: 'Rice',
    sku: 'RICE-1',
    hsn: '1006',
    price: 100,
    qty: 1
  };
  const { order } = createOrder([item]);
  const html = invoice.render(order);

  assert.match(html, /GST Amt<\/th>/);
  assert.match(html, /5%/);
  assert.match(html, /₹5\.00/);
  assert.match(html, /Invoice Total<\/td><td class="r">₹105\.00/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
});

test('invoice figures match the customer billed totals and HSN GST after coupon allocation', () => {
  const items = [
    { id: 5, name: 'Rice', sku: 'RICE-1', hsn: '1006', price: 1000, qty: 1 },
    { id: 6, name: 'Tea', sku: 'TEA-1', hsn: '0902', price: 300, qty: 1 }
  ];
  const { order, totals } = createOrder(items, 'WELCOME');
  const figures = invoice.computeInvoiceFigures(order);

  assert.equal(figures.subtotal, totals.subtotal);
  assert.equal(figures.discount, totals.discount);
  assert.equal(figures.tax, totals.tax);
  assert.equal(figures.cgst, totals.cgst);
  assert.equal(figures.sgst, totals.sgst);
  assert.equal(figures.total, order.total);
  assert.deepEqual(figures.rows.map((row) => row.gstPercent), [5, 18]);
  assert.deepEqual(figures.rows.map((row) => row.lineTax), totals.lines.map((line) => line.tax));
});
