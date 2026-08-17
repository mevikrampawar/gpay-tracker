/**
 * Best-effort classification of a counterparty as a Merchant, Person, ATM or
 * Google/Pay system entity. Used for the recipient directory; the dashboard
 * lets you override the classification per recipient (stored locally).
 */

export type CounterpartyClass = "Merchant" | "Person" | "Atm" | "Google" | "Platform"

const MERCHANT_KEYWORDS = [
  "shop", "shops", "store", "stores", "restaurant", "hotel", "cafe", "cafes",
  "cake", "cakes", "bakery", "sweets", "bhandar", "bhojnalaya", "dhaba",
  "medico", "medica", "medical", "chemist", "pharmacy", "pharma", "clinic",
  "hospital", "nursing", "enterprise", "enterprises", "enterpris", "industries",
  "pvt", "ltd", "limited", "private", "traders", "garage", "services", "service",
  "motors", "automobiles", "auto", "electricity", "electric", "power", "energy",
  "prepaid", "postpaid", "broadband", "internet", "recharge", "telecom",
  "petroleum", "petrol", "fuel", "gas", "lpg", "agency", "agencies",
  "center", "centre", "joint", "snacks", "bhel", "pani", "puri", "chaat",
  "food", "foods", "kiosk", "outlet", "supermarket", "hypermarket", "mall",
  "kirana", "provision", "grocery", "mart", "bazar", "bazaar", "mandi",
  "zomato", "swiggy", "amazon", "flipkart", "mcdonald", "dominos", "kfc",
  "burger", "pizza", "icecream", "ice cream", "juice", "milkshake",
  "airline", "air", "rail", "irctc", "redbus", "makemytrip", "goibibo",
  "oyo", "uber", "ola", "rapido", "porter", "taxi", "travel",
  "netflix", "youtube", "spotify", "prime", "hotstar", "disney", "ott",
  "app store", "apple", "google play", "playstore", "steam", "epic",
  "salon", "parlour", "gym", "fitness", "studio", "academy", "classes",
  "tution", "tuition", "school", "college", "university", "institute",
  "event", "events", "ticket", "tickets", "bookmyshow", "paytm",
  "paytm", "phonepe", "cred", "mobikwik", "freecharge", "card",
  "wallet", "balance", "voucher", "rewards", "cashback",
  "electrician", "plumber", "contractor", "realty", "builders", "properties",
  "jewellery", "jewel", "gold", "silver", "fashion", "garments", "textiles",
  "footwear", "sports", "books", "stationery", "electronics", "appliances",
  "furniture", "kitchen", "decor", "gift", "gifts", "toys", "stationary",
  "laundry", "dryclean", "dry clean", "repair", "services pvt", "pvt ltd",
  "chemical", "packers", "logistics", "courier", "transport", "shipping",
  "industries", "manufacturing", "extraction", "trading", "trader", "exports",
  "organic", "fresh", "daily needs", "general stores", "provision store",
  "pan shop", "paan", "gutka", "cigarette", "tobacco",
  "chinese", "south indian", "pure veg", "veg", "non-veg", "mess",
  "lodge", "inn", "resort", "spa", "wellness", "beauty",
  "insurance", "mutual", "fund", "investment", "share", "bazar", "broker",
  "consultancy", "consultants", "technologies", "tech", "software", "solutions",
  "digital", "media", "advertising", "printing", "print",
  "associates", "brothers", "co.", "co ", "and co", "& co",
]

const ATM_KEYWORDS = ["atm", "cash withdrawal"]

const GOOGLE_KEYWORDS = ["google"]

const PLATFORM_KEYWORDS = [
  "amazon pay", "phonepe", "google pay", "paytm", "cred", "mobikwik", "jio",
  "airtel", "vi prepaid", "vodafone", "idea", "irctc", "bookmyshow", "zomato",
  "swiggy", "ola money", "olacabs", "uber", "netflix", "prime", "hotstar",
  "1mg", "apollo pharmacy", "amazon",
]

const PERSON_HINTS = ["mr", "mrs", "ms", "miss", "master", "shri", "smt", "sri"]

export function classifyName(name: string | null, nameKey: string | null): CounterpartyClass {
  if (!name) return "Person"
  const lower = name.toLowerCase()
  const key = nameKey ?? ""

  if (ATM_KEYWORDS.some((k) => lower.includes(k))) return "Atm"
  if (GOOGLE_KEYWORDS.some((k) => lower === k || key === k)) return "Google"
  if (PLATFORM_KEYWORDS.some((k) => lower.includes(k))) return "Platform"

  const personHint = PERSON_HINTS.some((h) => key.startsWith(h))
  if (personHint) return "Person"

  const merchantHit = MERCHANT_KEYWORDS.some((k) => lower.includes(k))
  if (merchantHit) return "Merchant"

  // Long all-caps names with company-ish suffixes are usually merchants.
  const suffixHit = /(pvt|ltd|inc|corp|co|group|enterprise|services?|traders?|industries|agency)/i.test(lower)
  const tokens = key.split(" ")
  if (suffixHit && tokens.length >= 2) return "Merchant"

  return "Person"
}

export function classifyStyle(cls: CounterpartyClass): {
  badge: "default" | "secondary" | "outline" | "destructive"
} {
  switch (cls) {
    case "Merchant":
      return { badge: "default" }
    case "Atm":
      return { badge: "destructive" }
    case "Google":
      return { badge: "secondary" }
    case "Platform":
      return { badge: "outline" }
    default:
      return { badge: "secondary" }
  }
}
