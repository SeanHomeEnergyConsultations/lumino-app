export const CURRENT_AGREEMENT_VERSION = "2026-04-19";
export const CURRENT_AGREEMENT_HASH = "c594b8272551ad535f3b72f0d4f52b6bd43889ffeb328be4c217f98280147667";
export const CURRENT_AGREEMENT_COOKIE = "lumino_clickwrap_2026_04_19";

export const CLICKWRAP_TITLE = "Terms of Use";
export const CLICKWRAP_EFFECTIVE_DATE = "April 19, 2026";

export const CLICKWRAP_INTRO =
  "These Terms of Use (\"Terms\") govern access to and use of the application (the \"App\") operated by Sean Dotts (\"Developer,\" \"we,\" \"us\"). By accessing or using the App, you agree to these Terms.";

export const CLICKWRAP_SECTIONS = [
  {
    heading: "1. Use of the App",
    paragraphs: [
      "The App is a software platform that allows users to manage canvassing activities, record and organize property and homeowner information, track performance and productivity, and access optional data enrichment features.",
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
      "You are solely responsible for all data you enter into the App.",
      "You represent that you have the legal right to collect, use, and store such data, and that you will comply with all applicable laws, including privacy and solicitation laws.",
      "You will not enter or store sensitive personal data such as Social Security numbers, financial data, or health data, and you will not enter data obtained unlawfully or in violation of third-party rights.",
      "The Developer does not verify the accuracy or legality of user-provided data."
    ]
  },
  {
    heading: "4. Data Enrichment",
    paragraphs: [
      "The App may provide data from public records, third-party sources, or aggregated datasets.",
      "You acknowledge that such data may be incomplete or inaccurate and is provided for informational purposes only.",
      "You are responsible for how you use enriched or third-party data."
    ]
  },
  {
    heading: "5. Prohibited Conduct",
    paragraphs: [
      "You agree not to reverse engineer, decompile, or attempt to extract source code from the App.",
      "You also agree not to scrape, copy, or extract data from the App, use the App to build a competing product, use automation, bots, or scripts without permission, circumvent security or access controls, or upload unlawful, misleading, or harmful data."
    ]
  },
  {
    heading: "6. Third-Party Data Sources",
    paragraphs: [
      "The App may not be used to store or distribute data obtained in violation of third-party terms of service.",
      "You are responsible for ensuring that any data you upload or use complies with applicable agreements and restrictions."
    ]
  },
  {
    heading: "7. Intellectual Property",
    paragraphs: [
      "All rights to the App remain with Sean Dotts.",
      "You are granted a limited, revocable license to use the App. You may not copy, modify, distribute, or create derivative works from the App."
    ]
  },
  {
    heading: "8. Analytics & Performance Insights",
    paragraphs: [
      "The App may generate performance metrics, productivity insights, and recommendations.",
      "These outputs are informational only and are not guaranteed to be accurate or complete."
    ]
  },
  {
    heading: "9. Disclaimer of Warranties",
    paragraphs: ["The App is provided \"AS IS\" and \"AS AVAILABLE,\" without warranties of any kind."]
  },
  {
    heading: "10. Limitation of Liability",
    paragraphs: [
      "To the maximum extent permitted by law, Sean Dotts is not liable for any indirect or consequential damages, including data loss, business loss, or misuse of data.",
      "Total liability shall not exceed $0."
    ]
  },
  {
    heading: "11. Termination",
    paragraphs: [
      "Access may be suspended or terminated at any time.",
      "You must stop using the App upon termination."
    ]
  },
  {
    heading: "12. Governing Law",
    paragraphs: ["These Terms are governed by the laws of the Commonwealth of Massachusetts."]
  },
  {
    heading: "13. Changes to Terms",
    paragraphs: [
      "We may update these Terms at any time. Continued use of the App constitutes acceptance of updated Terms."
    ]
  }
] as const;
