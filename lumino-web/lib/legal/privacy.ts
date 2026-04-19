export const PRIVACY_POLICY_TITLE = "Privacy Policy";
export const PRIVACY_POLICY_EFFECTIVE_DATE = "April 19, 2026";

export const PRIVACY_POLICY_INTRO =
  "This Privacy Policy describes how Sean Dotts (\"we,\" \"us\") collects and uses information in connection with the App.";

export const PRIVACY_POLICY_SECTIONS = [
  {
    heading: "1. Information We Collect",
    paragraphs: [
      "Account information may include name, email, organization, and role.",
      "Usage data may include app activity, canvassing actions, performance metrics, logs, and timestamps.",
      "Device information may include IP address, browser type, and device type.",
      "Users may enter information about third parties, including homeowner names, addresses, contact details, and notes. This data is controlled by the organization using the App.",
      "We may supplement records with enrichment data from public records and third-party data sources."
    ]
  },
  {
    heading: "2. How We Use Information",
    paragraphs: [
      "We use data to operate the App, provide CRM and canvassing tools, generate performance insights, improve functionality, and monitor security and prevent abuse."
    ]
  },
  {
    heading: "3. Data Ownership & Contribution Model",
    paragraphs: [
      "Organizations control Private Organization Data, which means data entered or uploaded without contribution consent. We process that data on the organization's behalf and do not reuse it outside that organization except as needed to operate the App for that organization.",
      "Contributed Data means data uploaded through features that require explicit contribution consent, including bulk upload, CSV import, or automated mapping and pinning workflows made available through free-tier or contribution-based access. Contributed Data may be retained in original, aggregated, enriched, or derived form and may be used to improve the App or create commercial data products."
    ]
  },
  {
    heading: "4. Data Sharing",
    paragraphs: [
      "We do not sell raw personal data directly.",
      "We may share aggregated, enriched, or derived datasets built from Contributed Data, share data with infrastructure providers, disclose data if required by law, or use data as necessary to protect system security."
    ]
  },
  {
    heading: "5. Data Security",
    paragraphs: [
      "We take reasonable measures to protect data.",
      "However, the App may be in beta, security is not guaranteed, and users should not upload sensitive personal information."
    ]
  },
  {
    heading: "6. User Responsibilities",
    paragraphs: [
      "You agree that you have the right to collect and use any data you enter, that you will comply with applicable laws, and that you will not misuse personal data."
    ]
  },
  {
    heading: "7. Data Retention",
    paragraphs: ["We retain data as needed to provide services, support organizations, and improve the App."]
  },
  {
    heading: "8. Children",
    paragraphs: ["The App is not intended for users under 18."]
  },
  {
    heading: "9. Changes",
    paragraphs: ["We may update this policy. Continued use of the App constitutes acceptance of the updated policy."]
  },
  {
    heading: "10. Contact",
    paragraphs: ["Sean Dotts", "Email: sean.dotts@gmail.com"]
  }
] as const;
