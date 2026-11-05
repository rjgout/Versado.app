import { z } from "zod";
import { commitAccountMutation, type AccountActor } from "@/lib/account/mutation";
import { emitToUser } from "@/lib/realtime";
import { DATA_EVENT_SOCKET_NAME } from "@/lib/data/scopes";

export const listKeySchema = z.enum(["courses", "games", "today-continue"]);
export const listPreferenceSchema = z.object({
  listKey: listKeySchema,
  itemKeys: z.array(z.string().min(1).max(100)).max(200).optional(),
  hiddenKeys: z.array(z.string().min(1).max(100)).max(200).optional(),
  hideKeys: z.array(z.string().min(1).max(100)).max(200).optional(),
}).strict().refine(v => v.itemKeys !== undefined || v.hiddenKeys !== undefined || v.hideKeys !== undefined);

/** Eén bestaande UserListOrder-opslag voor web/native. De User-lock voorkomt
 * verloren voorkeuren bij gelijktijdige acties; lezen en schrijven delen de commit.
 */
export async function saveListPreferences(actor: AccountActor, input: z.infer<typeof listPreferenceSchema>) {
  const value = listPreferenceSchema.parse(input);
  await commitAccountMutation(actor, [], async tx => {
    const existing = await tx.userListOrder.findMany({ where: { userId: actor.userId, listKey: value.listKey }, orderBy: { order: "asc" } });
    const hide = new Set(value.hideKeys ?? []);
    const itemKeys = [...new Set(value.itemKeys ?? existing.filter(r => !r.hidden).map(r => r.itemKey))].filter(key => !hide.has(key));
    const visible = new Set(itemKeys);
    const hiddenKeys = [...new Set([...(value.hiddenKeys ?? existing.filter(r => r.hidden).map(r => r.itemKey)), ...hide])].filter(key => !visible.has(key));
    await tx.userListOrder.deleteMany({ where: { userId: actor.userId, listKey: value.listKey } });
    await tx.userListOrder.createMany({ data: [
      ...itemKeys.map((itemKey, order) => ({ userId: actor.userId, listKey: value.listKey, itemKey, order })),
      ...hiddenKeys.map((itemKey, i) => ({ userId: actor.userId, listKey: value.listKey, itemKey, order: itemKeys.length + i, hidden: true })),
    ] });
  });
  emitToUser(actor.userId, DATA_EVENT_SOCKET_NAME, { event: "coursesChanged" });
}
