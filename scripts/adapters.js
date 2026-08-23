export class SystemAdapter {
  getCharacter(user) {
    return user?.character ?? null;
  }

  getName(actor) {
    return actor?.name ?? "Безымянный персонаж";
  }

  getImage(actor) {
    return actor?.img ?? actor?.prototypeToken?.texture?.src ?? "";
  }

  getPortrait(user) {
    const actor = this.getCharacter(user);
    if (!actor) return null;
    return {
      id: `user-${user.id}`,
      profileId: `user-${user.id}`,
      sourceUserId: user.id,
      sourceActorId: actor.id,
      name: this.getName(actor),
      image: this.getImage(actor),
      slot: 0,
      side: "left",
      flipped: false,
      position: null,
      hidden: false
    };
  }
}

export function getSystemAdapter() {
  const currentGame = globalThis.game;
  const systemId = currentGame?.system?.id;
  const custom = currentGame?.modules?.get("vn-live-stage")?.api?.adapters?.[systemId];
  return custom ?? new SystemAdapter();
}
