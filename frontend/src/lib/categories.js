export const CATEGORIES = [
  {
    id: "finance-accounting",
    name: "Finance and Accounting",
    short: "Finance",
    group: "main",
    accent: "text-emerald-700",
    bgSoft: "bg-emerald-50",
    cover:
      "https://static.prod-images.emergentagent.com/jobs/051d676b-a320-4147-a337-b8bba2d73213/images/878f7e636a5562e7b097b372e95cceeb2d6c479bed189ace548ef332ecfe05c3.png",
  },
  {
    id: "esg-sustainability",
    name: "ESG and Sustainability",
    short: "ESG",
    group: "main",
    accent: "text-orange-700",
    bgSoft: "bg-orange-50",
    cover:
      "https://static.prod-images.emergentagent.com/jobs/051d676b-a320-4147-a337-b8bba2d73213/images/044d036534d78c033c958e052ffbbe0dbd77fdf707d9fb8b68e452315f7f0f8a.png",
  },
  {
    id: "claude-chat",
    name: "Claude · Chat",
    short: "Chat",
    group: "claude",
    accent: "text-blue-700",
    bgSoft: "bg-blue-50",
    cover:
      "https://static.prod-images.emergentagent.com/jobs/051d676b-a320-4147-a337-b8bba2d73213/images/5e0fd5f3eda9e656b0f7efd95e7bc945bc63129f6120a0770ab8f69546751234.png",
  },
  {
    id: "claude-cowork",
    name: "Claude · Co-work",
    short: "Co-work",
    group: "claude",
    accent: "text-blue-700",
    bgSoft: "bg-blue-50",
    cover:
      "https://static.prod-images.emergentagent.com/jobs/051d676b-a320-4147-a337-b8bba2d73213/images/5e0fd5f3eda9e656b0f7efd95e7bc945bc63129f6120a0770ab8f69546751234.png",
  },
  {
    id: "claude-code",
    name: "Claude · Code",
    short: "Code",
    group: "claude",
    accent: "text-blue-700",
    bgSoft: "bg-blue-50",
    cover:
      "https://static.prod-images.emergentagent.com/jobs/051d676b-a320-4147-a337-b8bba2d73213/images/5e0fd5f3eda9e656b0f7efd95e7bc945bc63129f6120a0770ab8f69546751234.png",
  },
];

export const CATEGORY_BY_ID = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c])
);

export const FILE_EXT_LABEL = {
  pdf: "PDF",
  doc: "DOC",
  docx: "DOCX",
  ppt: "PPT",
  pptx: "PPTX",
};
