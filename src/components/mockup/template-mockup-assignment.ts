export interface TemplateMockupAssignmentItem {
  id: string;
  mockupId: string;
  appliesToColorIds: string[];
}

export type TemplateMockupAssignmentOperation =
  | { type: "delete"; itemId: string }
  | { type: "patch"; itemId: string; appliesToColorIds: string[] }
  | { type: "post"; mockupId: string; appliesToColorIds: string[] };

export function buildAssignMockupToColorOperations(
  items: TemplateMockupAssignmentItem[],
  chosenMockupId: string,
  colorId: string,
): TemplateMockupAssignmentOperation[] {
  const operations: TemplateMockupAssignmentOperation[] = [];
  const chosenItem = items.find((item) => item.mockupId === chosenMockupId) ?? null;

  for (const existingItem of items) {
    if (existingItem.mockupId === chosenMockupId || !existingItem.appliesToColorIds.includes(colorId)) {
      continue;
    }

    const nextColorIds = existingItem.appliesToColorIds.filter((id) => id !== colorId);
    if (nextColorIds.length === 0) {
      operations.push({ type: "delete", itemId: existingItem.id });
    } else {
      operations.push({ type: "patch", itemId: existingItem.id, appliesToColorIds: nextColorIds });
    }
  }

  if (!chosenItem) {
    operations.push({ type: "post", mockupId: chosenMockupId, appliesToColorIds: [colorId] });
    return operations;
  }

  if (!chosenItem.appliesToColorIds.includes(colorId)) {
    operations.push({
      type: "patch",
      itemId: chosenItem.id,
      appliesToColorIds: [...chosenItem.appliesToColorIds, colorId],
    });
  }

  return operations;
}
