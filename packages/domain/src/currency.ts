export type CurrencyCode = string;

const zeroMinorDigitCurrencies = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "UYI",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF"
]);

const threeMinorDigitCurrencies = new Set([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND"
]);

const fourMinorDigitCurrencies = new Set(["CLF", "UYW"]);

export function minorDigits(currency: CurrencyCode): number {
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("INVALID_CURRENCY");
  }

  if (zeroMinorDigitCurrencies.has(currency)) {
    return 0;
  }
  if (threeMinorDigitCurrencies.has(currency)) {
    return 3;
  }
  if (fourMinorDigitCurrencies.has(currency)) {
    return 4;
  }
  return 2;
}
