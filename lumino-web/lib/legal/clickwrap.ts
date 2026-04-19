export const CURRENT_AGREEMENT_VERSION = "2026-04-19-contribution";
export const CURRENT_AGREEMENT_HASH = "622f1acc333bdc301ba38e9ab0d533760d9214f3dc83371e0d1d036612b07cf5";
export const CURRENT_AGREEMENT_COOKIE = "lumino_clickwrap_2026_04_19_contribution";

export const CLICKWRAP_TITLE = "Terms of Use";
export const CLICKWRAP_EFFECTIVE_DATE = "April 19, 2026";

export const CLICKWRAP_INTRO =
  "These Terms of Use (\"Terms\") govern access to and use of the application (the \"App\") operated by Sean Dotts (\"Developer,\" \"we,\" \"us\"). By accessing or using the App, you agree to these Terms.";

export const CLICKWRAP_SECTIONS = [
  {
    heading: "1. Use of the App",
    paragraphs: [
      "The App is a software platform that enables users to conduct canvassing activities, record and manage property and homeowner data, track performance and productivity, and access optional data enrichment features.",
      "You may use the App only in compliance with these Terms and applicable laws."
    ]
  },
  {
    heading: "2. Accounts & Organizations",
    paragraphs: [
      "Users may access the App individually or as part of an organization.",
      "Organizations may assign roles, including admin, manager, and user roles.",
      "You are responsible for all activity under your account and may not share login credentials."
    ]
  },
  {
    heading: "3. User Data & Responsibility",
    paragraphs: [
      "You are solely responsible for all data you upload or enter into the App.",
      "You represent that you have the legal right to collect, use, and store such data, and that you will comply with all applicable laws, including privacy and solicitation laws.",
      "You will not upload or store sensitive personal data such as Social Security numbers, financial data, or health data, and you will not upload data obtained unlawfully or in violation of third-party rights or restrictions.",
      "The Developer does not verify the accuracy or legality of user-provided data."
    ]
  },
  {
    heading: "4. Data Ownership Model",
    paragraphs: [
      "The App supports two categories of data: Private Organization Data and Contributed Data.",
      "Private Organization Data means data entered or uploaded without contribution consent. Private Organization Data remains private to the organization that supplied it and will not be reused, shared, or sold by the Developer except as needed to operate the App for that organization.",
      "Contributed Data means data uploaded through features that require explicit contribution consent, including bulk upload, CSV import, or automated mapping and pinning workflows made available to free-tier organizations or other contribution-based access models."
    ]
  },
  {
    heading: "5. Contributed Data License",
    paragraphs: [
      "If you explicitly opt in to contribute uploaded data, you grant Sean Dotts a perpetual, irrevocable, worldwide, royalty-free license to use that uploaded data, aggregate it with other datasets, enrich and transform it, create derivative datasets, improve the App, and commercialize, license, or sell original, aggregated, enriched, or derived datasets built from that contributed data.",
      "Contributed Data may be combined with other user-supplied or platform-supplied data, and you will not receive compensation for contributed uploads. Paid organizations that do not opt into contribution retain their uploaded data as Private Organization Data."
    ]
  },
  {
    heading: "6. Explicit Contribution Consent Requirement",
    paragraphs: [
      "You may only use certain features, including bulk upload, CSV import, or automated map pinning workflows, if you explicitly agree through a checkbox or similar in-product mechanism that the uploaded data will become Contributed Data.",
      "The Developer may log the consent timestamp, agreement version, user identity, IP address, and user agent to document that consent."
    ]
  },
  {
    heading: "7. Third-Party Data Compliance",
    paragraphs: [
      "The App may not be used to store or distribute data obtained in violation of third-party terms of service.",
      "You are responsible for ensuring that any data you upload or use complies with applicable agreements and restrictions."
    ]
  },
  {
    heading: "8. Data Enrichment",
    paragraphs: [
      "The App may provide data from public records, third-party sources, or aggregated datasets.",
      "You acknowledge that such data may be incomplete or inaccurate and is provided for informational purposes only.",
      "You are responsible for how you use enriched or third-party data."
    ]
  },
  {
    heading: "9. Prohibited Conduct",
    paragraphs: [
      "You agree not to reverse engineer, decompile, or attempt to extract source code from the App.",
      "You also agree not to scrape, copy, or extract data from the App, use the App to build a competing product, use automation, bots, or scripts without permission, circumvent security or access controls, or upload unlawful, misleading, or harmful data."
    ]
  },
  {
    heading: "10. Intellectual Property",
    paragraphs: [
      "All rights to the App remain with Sean Dotts.",
      "You are granted a limited, revocable license to use the App. You may not copy, modify, distribute, or create derivative works from the App."
    ]
  },
  {
    heading: "11. Disclaimer of Warranties",
    paragraphs: ["The App is provided \"AS IS\" and \"AS AVAILABLE,\" without warranties of any kind."]
  },
  {
    heading: "12. Limitation of Liability",
    paragraphs: [
      "To the maximum extent permitted by law, Sean Dotts is not liable for any indirect or consequential damages, including data loss, business loss, or misuse of data.",
      "Total liability shall not exceed $0."
    ]
  },
  {
    heading: "13. Termination",
    paragraphs: [
      "Access may be suspended or terminated at any time.",
      "You must stop using the App upon termination."
    ]
  },
  {
    heading: "14. Governing Law",
    paragraphs: ["These Terms are governed by the laws of the Commonwealth of Massachusetts."]
  },
  {
    heading: "15. Changes to Terms",
    paragraphs: [
      "We may update these Terms at any time. Continued use of the App constitutes acceptance of updated Terms."
    ]
  }
] as const;
