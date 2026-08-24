export type PlanTier = {
  priceId: string;
  name: string;
  tagline: string;
  priceLabel: string;
  features: string[];
  cta: string;
  highlight?: boolean;
};

export const FREE_TIER: PlanTier = {
  priceId: "free",
  name: "Free",
  tagline: "Everything you need to start playing",
  priceLabel: "Free",
  features: [
    "Create your player profile & availability",
    "Browse and request to join games",
    "Discover players, teams, trainers & gyms",
    "3 free AI highlight reels",
    "Messaging & push notifications",
  ],
  cta: "Included",
};

export const PLAN_TIERS: PlanTier[] = [
  {
    priceId: "ai_highlight_reel_monthly",
    name: "AI Highlight Reels",
    tagline: "Unlimited reels from your game clips",
    priceLabel: "$15/mo",
    features: ["3 free reels to start", "Unlimited AI generation", "HD exports & captions"],
    cta: "Subscribe",
  },
  {
    priceId: "host_subscription_monthly",
    name: "Host Subscription",
    tagline: "For organizers running games regularly",
    priceLabel: "$10/mo",
    features: ["Unlimited game listings", "Featured placement", "Host analytics"],
    cta: "Become a Host",
    highlight: true,
  },
  {
    priceId: "team_plan_monthly",
    name: "Team Plan",
    tagline: "Up to 10 players, shared team page",
    priceLabel: "$49/mo",
    features: ["Unlimited reels for 10 players", "Shared team page", "Captain controls"],
    cta: "Start Team Plan",
  },
  {
    priceId: "org_plan_monthly",
    name: "Org Plan",
    tagline: "For clubs and larger orgs",
    priceLabel: "$99/mo",
    features: ["Up to 25 players", "Branded team page", "Priority support"],
    cta: "Start Org Plan",
  },
];

export type MerchItem = {
  priceId: string;
  name: string;
  description: string;
  priceLabel: string;
  emoji: string;
};

export const MERCH_ITEMS: MerchItem[] = [
  {
    priceId: "merch_tee_onetime",
    name: "Logo Tee",
    description: "Soft cotton tee with embroidered logo",
    priceLabel: "$25",
    emoji: "👕",
  },
  {
    priceId: "merch_hoodie_onetime",
    name: "Pullover Hoodie",
    description: "Heavyweight pullover with logo",
    priceLabel: "$55",
    emoji: "🧥",
  },
  {
    priceId: "merch_hat_onetime",
    name: "Snapback Hat",
    description: "Adjustable snapback with embroidered logo",
    priceLabel: "$20",
    emoji: "🧢",
  },
];
