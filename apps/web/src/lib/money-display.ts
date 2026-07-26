export function addExactMoney(values: string[]): string {
  let satang = 0n;
  for (const value of values) {
    const negative = value.startsWith("-");
    const unsigned = negative ? value.slice(1) : value;
    const [whole = "0", fraction = ""] = unsigned.split(".");
    const normalized = `${whole}${fraction.padEnd(2, "0").slice(0, 2)}`;
    const amount = BigInt(normalized || "0");
    satang += negative ? -amount : amount;
  }
  const negative = satang < 0n;
  const absolute = negative ? -satang : satang;
  const whole = (absolute / 100n).toString();
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function formatMoney(amount: string, currency = "THB") {
  const negative = amount.startsWith("-");
  const unsigned = negative ? amount.slice(1) : amount;
  const [whole = "0", fraction = "00"] = unsigned.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const symbol = currency === "THB" ? "฿" : `${currency} `;
  return `${negative ? "−" : ""}${symbol}${grouped}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}
