export const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
export function calculate(items, interstate) {
  const lines = items.map(i => {
    const gross = round(i.qty * i.rate), discount = round(gross * i.discount / 100);
    const taxable = round(gross - discount);
    const cgst = interstate ? 0 : round(taxable * i.gst / 200);
    const sgst = cgst, igst = interstate ? round(taxable * i.gst / 100) : 0;
    return {...i, gross, discountAmount: discount, taxable, cgst, sgst, igst, total: round(taxable + cgst + sgst + igst)};
  });
  const sum = key => round(lines.reduce((s,i) => s+i[key],0));
  return {lines, subtotal:sum('gross'), discount:sum('discountAmount'), taxable:sum('taxable'), cgst:sum('cgst'), sgst:sum('sgst'), igst:sum('igst'), total:sum('total'), interstate};
}
export function financialYear(date) {const [year, month]=date.split('-').map(Number);return String(month>=4?year:year-1).slice(-2);}
export function documentNumber(type,date,sequence){return `${type==='invoice'?'INV':'QUO'}/${financialYear(date)}/${String(sequence).padStart(6,'0')}`;}
