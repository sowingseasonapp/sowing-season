// Seed profile registry — data from the bank-CSV research pass (see
// _cowork/bank-csv-research/01-BANK-CSV-FORMAT-REFERENCE.md for the evidence).
// Shipped as a module so the renderer can import it without a bundler.
// The two non-US entries are recognitionOnly per decision D1: they exist so a
// refusal can NAME the format, never to import it.
export default {
  "$schema": "seed profile registry for the Family Budget CSV importer",
  "generated": "2026-08-11",
  "generatedBy": "Cowork research pass — see 01-BANK-CSV-FORMAT-REFERENCE.md",
  "readme": [
    "Seed data only. Entries marked VERIFIED had their literal header row found in a committed",
    "sample CSV, a parser test fixture, or a config quoting it. REPORTED entries were described",
    "by a credible secondary source but the literal text was not seen — confirm at runtime and",
    "prefer inference over trusting these blindly. No header row here was invented.",
    "",
    "headerCells are lowercased and trimmed for matching. signConvention values:",
    "  as-is                   single signed Amount column; spending is already negative",
    "  flip                    single signed Amount column; spending is POSITIVE, negate it",
    "  split-positive          separate debit/credit columns, both written positive",
    "  unsigned-with-direction unsigned amount plus a direction/type indicator column",
    "  parentheses             single column using accounting parentheses for outflows",
    "",
    "dateOrder AUTO means the institution has shipped more than one format — sniff per file.",
    "Always run the balance reconciliation check where a balance role exists; it overrides",
    "anything asserted here."
  ],
  "profiles": [
    {
      "id": "chase-checking-v3",
      "name": "Chase — checking/savings (current)",
      "confidence": "VERIFIED",
      "headerCells": [
        "details",
        "posting date",
        "description",
        "amount",
        "type",
        "balance",
        "check or slip #"
      ],
      "notes": "Header may be quoted as \"Description\" and may end with a trailing comma (8 fields).",
      "allowTrailingEmpty": true,
      "delimiter": ",",
      "dateOrder": "MDY",
      "decimalMark": ".",
      "skipLeading": 0,
      "skipTrailing": 0,
      "roles": [
        "direction",
        "date_transaction",
        "description",
        "amount",
        "ignore",
        "balance",
        "check_number"
      ],
      "signConvention": "as-is",
      "directionTokens": {
        "debit": "out",
        "credit": "in",
        "check": "out",
        "dslip": "in"
      },
      "footerQuirk": "File may end with 4 blank CRLF lines."
    },
    {
      "id": "chase-checking-v2",
      "name": "Chase — checking (2013–2016)",
      "confidence": "VERIFIED",
      "headerCells": [
        "type",
        "post date",
        "description",
        "amount",
        "check or slip #"
      ],
      "delimiter": ",",
      "dateOrder": "MDY",
      "decimalMark": ".",
      "roles": [
        "direction",
        "date_transaction",
        "description",
        "amount",
        "check_number"
      ],
      "signConvention": "as-is"
    },
    {
      "id": "chase-card-v3",
      "name": "Chase — credit card (2019+)",
      "confidence": "VERIFIED",
      "headerCells": [
        "card",
        "transaction date",
        "post date",
        "description",
        "category",
        "type",
        "amount",
        "memo"
      ],
      "delimiter": ",",
      "dateOrder": "MDY",
      "decimalMark": ".",
      "roles": [
        "account",
        "date_transaction",
        "date_posted",
        "description",
        "category",
        "status",
        "amount",
        "memo"
      ],
      "signConvention": "as-is",
      "typeTokens": [
        "Sale",
        "Payment",
        "Return",
        "Adjustment",
        "Fee"
      ]
    },
    {
      "id": "chase-card-v3b",
      "name": "Chase — credit card (2026, no Card column)",
      "confidence": "VERIFIED",
      "headerCells": [
        "transaction date",
        "post date",
        "description",
        "category",
        "type",
        "amount",
        "memo"
      ],
      "delimiter": ",",
      "dateOrder": "MDY",
      "decimalMark": ".",
      "roles": [
        "date_transaction",
        "date_posted",
        "description",
        "category",
        "status",
        "amount",
        "memo"
      ],
      "signConvention": "as-is",
      "warning": "COLLISION: identical to a header some catalogs label 'Amex'. If Type holds Sale/Payment it is Chase (purchases NEGATIVE)."
    },
    {
      "id": "chase-card-v2",
      "name": "Chase — credit card (2015–2017)",
      "confidence": "VERIFIED",
      "headerCells": [
        "type",
        "trans date",
        "post date",
        "description",
        "amount"
      ],
      "delimiter": ",",
      "dateOrder": "MDY",
      "decimalMark": ".",
      "roles": [
        "status",
        "date_transaction",
        "date_posted",
        "description",
        "amount"
      ],
      "signConvention": "as-is",
      "warning": "Date is column 2, not column 1."
    },
    {
      "id": "bofa-checking",
      "name": "Bank of America — checking/savings/MMA",
      "confidence": "VERIFIED",
      "headerCells": [
        "date",
        "description",
        "amount",
        "running bal."
      ],
      "delimiter": ",",
      "dateOrder": "MDY",
      "decimalMark": ".",
      "skipLeading": 6,
      "roles": [
        "date_transaction",
        "description",
        "amount",
        "balance"
      ],
      "signConvention": "as-is",
      "warning": "Header is on row 7 behind a 5-row summary block + blank line. First data row 'Beginning balance as of ...' has an EMPTY amount and must be skipped."
    },
    {
      "id": "bofa-card",
      "name": "Bank of America — credit card",
      "confidence": "VERIFIED",
      "headerCells": [
        "posted date",
        "reference number",
        "payee",
        "address",
        "amount"
      ],
      "delimiter": ",",
      "dateOrder": "MDY",
      "decimalMark": ".",
      "roles": [
        "date_posted",
        "external_id",
        "description",
        "memo",
        "amount"
      ],
      "signConvention": "as-is",
      "warning": "Reference Number is space-padded blank (not empty) on payment rows. Only a posted date exists."
    },
    {
      "id": "wellsfargo",
      "name": "Wells Fargo — checking/savings/card",
      "confidence": "VERIFIED",
      "headerCells": null,
      "headerless": true,
      "fieldCount": 5,
      "delimiter": ",",
      "dateOrder": "MDY",
      "decimalMark": ".",
      "roles": [
        "date_transaction",
        "amount",
        "ignore",
        "check_number",
        "description"
      ],
      "signConvention": "as-is",
      "warning": "No header. Amount is field 2; description is LAST. All fields double-quoted."
    },
    {
      "id": "citi-card-6",
      "name": "Citi — credit card (with Member Name)",
      "confidence": "REPORTED",
      "headerCells": [
        "status",
        "date",
        "description",
        "debit",
        "credit",
        "member name"
      ],
      "delimiter": ",",
      "dateOrder": "MDY",
      "decimalMark": ".",
      "roles": [
        "status",
        "date_transaction",
        "description",
        "amount_debit",
        "amount_credit",
        "ignore"
      ],
      "signConvention": "split-positive",
      "pendingRule": {
        "column": "status",
        "pendingValue": "Pending"
      }
    },
    {
      "id": "citi-card-5",
      "name": "Citi — credit card (5 column)",
      "confidence": "REPORTED",
      "headerCells": [
        "status",
        "date",
        "description",
        "debit",
        "credit"
      ],
      "delimiter": ",",
      "dateOrder": "MDY",
      "decimalMark": ".",
      "roles": [
        "status",
        "date_transaction",
        "description",
        "amount_debit",
        "amount_credit"
      ],
      "signConvention": "split-positive",
      "pendingRule": {
        "column": "status",
        "pendingValue": "Pending"
      }
    },
    {
      "id": "capitalone-card",
      "name": "Capital One — credit card",
      "confidence": "VERIFIED",
      "headerCells": [
        "transaction date",
        "posted date",
        "card no.",
        "description",
        "category",
        "debit",
        "credit"
      ],
      "delimiter": ",",
      "dateOrder": "AUTO",
      "decimalMark": ".",
      "roles": [
        "date_transaction",
        "date_posted",
        "account",
        "description",
        "category",
        "amount_debit",
        "amount_credit"
      ],
      "signConvention": "split-positive",
      "warning": "Date format is NOT stable: ISO YYYY-MM-DD in 2023 exports, non-zero-padded M/D/YYYY in 2025 exports. Sniff it. Amounts may be unpadded (34.3, 450)."
    },
    {
      "id": "capitalone-360",
      "name": "Capital One 360 — checking/savings/MMA",
      "confidence": "VERIFIED",
      "headerCells": [
        "account number",
        "transaction date",
        "transaction amount",
        "transaction type",
        "transaction description",
        "balance"
      ],
      "delimiter": ",",
      "dateOrder": "MDY",
      "twoDigitYear": true,
      "decimalMark": ".",
      "roles": [
        "account",
        "date_transaction",
        "amount",
        "direction",
        "description",
        "balance"
      ],
      "signConvention": "as-is",
      "warning": "TWO-DIGIT YEAR (MM/DD/YY)."
    },
    {
      "id": "usbank",
      "name": "U.S. Bank — checking/savings/card",
      "confidence": "REPORTED",
      "headerCells": [
        "date",
        "transaction",
        "name",
        "memo",
        "amount"
      ],
      "delimiter": ",",
      "dateOrder": "MDY",
      "decimalMark": ".",
      "roles": [
        "date_transaction",
        "direction",
        "description",
        "memo",
        "amount"
      ],
      "signConvention": "as-is",
      "warning": "COLLISION: this 5-column shape resembles generic Mint/Quicken-ish exports. No balance column."
    },
    {
      "id": "pnc",
      "name": "PNC — checking/savings",
      "confidence": "REPORTED",
      "headerCells": [
        "date",
        "description",
        "withdrawals",
        "deposits",
        "balance"
      ],
      "delimiter": ",",
      "dateOrder": "UNKNOWN",
      "decimalMark": ".",
      "roles": [
        "date_transaction",
        "description",
        "amount_debit",
        "amount_credit",
        "balance"
      ],
      "signConvention": "split-positive"
    },
    {
      "id": "suntrust-legacy",
      "name": "SunTrust (legacy) — checking",
      "confidence": "VERIFIED",
      "headerCells": null,
      "headerless": true,
      "fieldCount": 6,
      "delimiter": ",",
      "dateOrder": "MDY",
      "decimalMark": ".",
      "roles": [
        "date_transaction",
        "check_number",
        "description",
        "amount_debit",
        "amount_credit",
        "balance"
      ],
      "signConvention": "split-positive",
      "warning": "Unused debit/credit cell is a literal '0', not empty and not '0.00'."
    },
    {
      "id": "bbt-legacy",
      "name": "BB&T (legacy EXPORT.CSV)",
      "confidence": "VERIFIED",
      "headerCells": null,
      "fieldCount": 6,
      "delimiter": ",",
      "decimalMark": ".",
      "roles": [
        "date_transaction",
        "direction",
        "check_number",
        "description",
        "amount",
        "balance"
      ],
      "signConvention": "parentheses",
      "warning": "Amounts carry $ and use accounting parentheses for outflows. Header text not verified; the amount header cell is literally 'Amount'."
    },
    {
      "id": "zions-business",
      "name": "Zions Bank — business online banking",
      "confidence": "VERIFIED",
      "headerCells": [
        "",
        "posted date",
        "description",
        "amount",
        "currency",
        "transaction reference number",
        "fi transaction reference",
        "payee",
        "transaction code",
        "server id",
        "sic code",
        "type",
        "credit/debit",
        "origination date",
        "available date",
        "original amount",
        "original currency"
      ],
      "delimiter": ",",
      "dateOrder": "YMD",
      "decimalMark": ".",
      "fieldCount": 18,
      "roles": [
        "ignore",
        "date_transaction",
        "description",
        "amount",
        "currency",
        "external_id",
        "external_id",
        "description",
        "ignore",
        "ignore",
        "ignore",
        "ignore",
        "direction",
        "ignore",
        "ignore",
        "ignore",
        "ignore"
      ],
      "signConvention": "unsigned-with-direction",
      "warning": "5 blank lines, then an accounts table, then this block. Rows begin with an empty field. Amount is UNSIGNED; direction is in Credit/Debit. Literal string 'null' appears as a value."
    },
    {
      "id": "amex-basic",
      "name": "American Express — basic 3-column",
      "confidence": "VERIFIED",
      "headerCells": [
        "date",
        "description",
        "amount"
      ],
      "delimiter": ",",
      "dateOrder": "MDY",
      "decimalMark": ".",
      "roles": [
        "date_transaction",
        "description",
        "amount"
      ],
      "signConvention": "flip",
      "warning": "COLLISION: Date,Description,Amount is also the generic 3-column shape where spend is usually NEGATIVE. Amex writes a CHARGE as POSITIVE. Do not auto-assign a sign on this header alone; filename 'activity.csv' is a hint."
    },
    {
      "id": "amex-wide-11",
      "name": "American Express — wide 'all details'",
      "confidence": "REPORTED",
      "headerCells": [
        "date",
        "description",
        "amount",
        "extended details",
        "appears on your statement as",
        "address",
        "city/state",
        "zip code",
        "country",
        "reference",
        "category"
      ],
      "delimiter": ",",
      "dateOrder": "MDY",
      "decimalMark": ".",
      "roles": [
        "date_transaction",
        "description",
        "amount",
        "memo",
        "memo",
        "ignore",
        "ignore",
        "ignore",
        "ignore",
        "external_id",
        "category"
      ],
      "signConvention": "flip",
      "warning": "Extended Details and City/State contain EMBEDDED NEWLINES inside quoted fields."
    },
    {
      "id": "amex-wide-13",
      "name": "American Express — wide + cardmember (business)",
      "confidence": "REPORTED",
      "headerCells": [
        "date",
        "description",
        "card member",
        "account #",
        "amount",
        "extended details",
        "appears on your statement as",
        "address",
        "city/state",
        "zip code",
        "country",
        "reference",
        "category"
      ],
      "delimiter": ",",
      "dateOrder": "MDY",
      "decimalMark": ".",
      "signConvention": "flip"
    },
    {
      "id": "discover-card",
      "name": "Discover — credit card",
      "confidence": "VERIFIED",
      "headerCells": [
        "trans. date",
        "post date",
        "description",
        "amount",
        "category"
      ],
      "delimiter": ",",
      "dateOrder": "MDY",
      "decimalMark": ".",
      "roles": [
        "date_transaction",
        "date_posted",
        "description",
        "amount",
        "category"
      ],
      "signConvention": "flip",
      "warning": "CRITICAL COLLISION with Chase. Match on the literal period in 'Trans. Date' and the ABSENCE of Type/Memo. Discover purchases are POSITIVE; Chase purchases are NEGATIVE. Header line may be prefixed by a TAB and data rows by two TABs."
    },
    {
      "id": "apple-card",
      "name": "Apple Card (Goldman Sachs)",
      "confidence": "VERIFIED",
      "headerCells": [
        "transaction date",
        "clearing date",
        "description",
        "merchant",
        "category",
        "type",
        "amount (usd)"
      ],
      "delimiter": ",",
      "dateOrder": "MDY",
      "decimalMark": ".",
      "roles": [
        "date_transaction",
        "date_posted",
        "description",
        "description",
        "category",
        "status",
        "amount"
      ],
      "signConvention": "flip",
      "typeTokens": [
        "Purchase",
        "Payment",
        "Return",
        "Credit"
      ],
      "warning": "File ships WITHOUT a trailing newline — a line-oriented reader drops the last row. Clearing Date blank = pending. Two payee columns."
    },
    {
      "id": "cu-platform-8col",
      "name": "Small bank / credit union — 8-column platform shape",
      "confidence": "VERIFIED",
      "headerCells": [
        "account",
        "post date",
        "check",
        "description",
        "debit",
        "credit",
        "status",
        "balance"
      ],
      "delimiter": ",",
      "dateOrder": "MDY",
      "noLeadingZeros": true,
      "decimalMark": ".",
      "roles": [
        "account",
        "date_transaction",
        "check_number",
        "description",
        "amount_debit",
        "amount_credit",
        "status",
        "balance"
      ],
      "signConvention": "split-positive",
      "warning": "Seen verbatim at 3 unrelated institutions. Default filename AccountHistory.csv. Dates have NO leading zeros."
    },
    {
      "id": "cu-comments-5col",
      "name": "Credit union — Comments second-description shape",
      "confidence": "VERIFIED",
      "headerCells": [
        "date",
        "description",
        "comments",
        "check number",
        "amount"
      ],
      "delimiter": ",",
      "decimalMark": ".",
      "roles": [
        "date_transaction",
        "description",
        "memo",
        "check_number",
        "amount"
      ],
      "signConvention": "as-is",
      "warning": "Column ORDER not established — match by name. The Comments column often holds the real merchant string."
    },
    {
      "id": "usaa-legacy",
      "name": "USAA — legacy bk_download.csv",
      "confidence": "VERIFIED",
      "headerCells": null,
      "headerless": true,
      "fieldCount": 7,
      "delimiter": ",",
      "dateOrder": "MDY",
      "decimalMark": ".",
      "roles": [
        "status",
        "ignore",
        "date_transaction",
        "memo",
        "description",
        "ignore",
        "amount"
      ],
      "signConvention": "as-is"
    },
    {
      "id": "dcu-cu",
      "name": "DCU-style credit union export",
      "confidence": "VERIFIED",
      "headerCells": [
        "date",
        "transaction type",
        "description",
        "amount",
        "id",
        "memo",
        "current balance"
      ],
      "delimiter": ",",
      "dateOrder": "MDY",
      "decimalMark": ".",
      "roles": [
        "date_transaction",
        "direction",
        "description",
        "amount",
        "external_id",
        "memo",
        "balance"
      ],
      "signConvention": "as-is",
      "warning": "Amounts written as -$7,971.39 — minus BEFORE the dollar sign. Header is ALL CAPS."
    },
    {
      "id": "simplefin",
      "name": "SimpleFIN Bridge CSV",
      "confidence": "VERIFIED",
      "headerCells": null,
      "skipLeading": 2,
      "fieldCount": 6,
      "delimiter": ",",
      "decimalMark": ".",
      "roles": [
        "date_transaction",
        "amount",
        "description",
        "description",
        "memo",
        "external_id"
      ],
      "signConvention": "as-is",
      "warning": "Two preamble rows. Has a stable id column suitable for dedupe."
    },
    {
      "id": "ally-bank",
      "name": "Ally Bank — checking/savings",
      "confidence": "VERIFIED",
      "headerCells": [
        "date",
        "time",
        "amount",
        "type",
        "description"
      ],
      "delimiter": ",",
      "dateOrder": "YMD",
      "decimalMark": ".",
      "roles": [
        "date_transaction",
        "ignore",
        "amount",
        "direction",
        "description"
      ],
      "signConvention": "as-is",
      "warning": "Header cells literally have a LEADING SPACE (' Amount', ' Type', ' Description'). Trim header cells."
    },
    {
      "id": "schwab-checking",
      "name": "Charles Schwab Bank — checking",
      "confidence": "VERIFIED",
      "headerCells": [
        "date",
        "status",
        "type",
        "checknumber",
        "description",
        "withdrawal",
        "deposit",
        "runningbalance"
      ],
      "delimiter": ",",
      "dateOrder": "MDY",
      "decimalMark": ".",
      "skipLeading": 0,
      "roles": [
        "date_transaction",
        "status",
        "direction",
        "check_number",
        "description",
        "amount_debit",
        "amount_credit",
        "balance"
      ],
      "signConvention": "split-positive",
      "warning": "Amounts carry $ and thousands commas inside quotes. Some exports have 3 preamble rows. Older vintages use Credits/Debits instead of Deposit/Withdrawal."
    },
    {
      "id": "fidelity-cma",
      "name": "Fidelity — CMA / brokerage history",
      "confidence": "VERIFIED",
      "headerCells": [
        "run date",
        "action",
        "symbol",
        "security description",
        "security type",
        "quantity",
        "price ($)",
        "commission ($)",
        "fees ($)",
        "accrued interest ($)",
        "amount ($)",
        "settlement date"
      ],
      "delimiter": ",",
      "dateOrder": "MDY",
      "decimalMark": ".",
      "skipLeading": 5,
      "skipTrailing": 14,
      "roles": [
        "date_transaction",
        "description",
        "ignore",
        "description",
        "ignore",
        "ignore",
        "ignore",
        "ignore",
        "ignore",
        "ignore",
        "amount",
        "date_posted"
      ],
      "signConvention": "as-is",
      "warning": "5 preamble rows of ',,,,,,,,,,,' and 14 footer disclaimer rows."
    },
    {
      "id": "paypal-classic",
      "name": "PayPal — classic Activity download",
      "confidence": "VERIFIED",
      "headerCells": [
        "date",
        "time",
        "timezone",
        "name",
        "type",
        "status",
        "currency",
        "gross",
        "fee",
        "net"
      ],
      "headerPrefixOnly": true,
      "delimiter": ",",
      "dateOrder": "MDY",
      "decimalMark": ".",
      "roles": [
        "date_transaction",
        "ignore",
        "ignore",
        "description",
        "status",
        "status",
        "currency",
        "amount",
        "ignore",
        "ignore"
      ],
      "signConvention": "as-is",
      "warning": "41 columns, all quoted. Gross/Fee/Net triple; Gross is the transaction amount. TimeZone is an abbreviation, not an offset. Currency conversions arrive as a 4-row group for one economic event."
    },
    {
      "id": "mint-classic",
      "name": "Mint — transactions.csv",
      "confidence": "VERIFIED",
      "headerCells": [
        "date",
        "description",
        "original description",
        "amount",
        "transaction type",
        "category",
        "account name",
        "labels",
        "notes"
      ],
      "delimiter": ",",
      "dateOrder": "MDY",
      "twoDigitYear": true,
      "decimalMark": ".",
      "roles": [
        "date_transaction",
        "description",
        "memo",
        "amount",
        "direction",
        "category",
        "account",
        "ignore",
        "memo"
      ],
      "signConvention": "unsigned-with-direction",
      "directionTokens": {
        "debit": "out",
        "credit": "in"
      },
      "warning": "Amounts are UNSIGNED magnitudes; direction lives in Transaction Type. Descriptions can contain embedded newlines."
    },
    {
      "id": "monzo-uk",
      "name": "Monzo (UK) — current/joint account",
      "confidence": "VERIFIED",
      "headerCells": [
        "transaction id",
        "date",
        "time",
        "type",
        "name",
        "emoji",
        "category",
        "amount",
        "currency",
        "local amount",
        "local currency",
        "notes and #tags",
        "address",
        "receipt",
        "description",
        "category split",
        "money out",
        "money in",
        "balance",
        "balance currency"
      ],
      "delimiter": ",",
      "dateOrder": "DMY",
      "decimalMark": ".",
      "encoding": "utf-8",
      "roles": [
        "external_id",
        "date_transaction",
        "ignore",
        "direction",
        "description",
        "ignore",
        "category",
        "amount",
        "currency",
        "ignore",
        "ignore",
        "memo",
        "ignore",
        "ignore",
        "description",
        "ignore",
        "amount_debit",
        "amount_credit",
        "balance",
        "ignore"
      ],
      "signConvention": "as-is",
      "warning": "UTF-8 is mandatory — the Emoji column contains real emoji. DD/MM/YYYY.",
      "recognitionOnly": true
    },
    {
      "id": "sparkasse-de",
      "name": "Sparkasse (DE) — CSV-CAMT",
      "confidence": "REPORTED",
      "delimiter": ";",
      "dateOrder": "DMY",
      "decimalMark": ",",
      "encoding": "windows-1252",
      "twoDigitYear": true,
      "signConvention": "as-is",
      "warning": "Semicolon-delimited, decimal comma, DD.MM.YY, non-UTF8. Column names in German (Buchungstag, Verwendungszweck, Betrag). ~370 local Sparkassen share this.",
      "recognitionOnly": true
    }
  ]
};
