// ---------------- PEER RESOLUTION & FORCING HELPER ----------------
async function resolveTargetPeer(client: any, uid: number, pInfo: PeerInfo | undefined, phone: string): Promise<any> {
  const uidCleanStr = String(uid).replace(/[^0-9-]/g, '');

  // Level 0: Contact-locked Permanent AccessHash (Direct, never expires even if user left stream)
  if (pInfo?.isContactLocked && pInfo?.accessHash && String(pInfo.accessHash) !== '0') {
    const inputPeer = new Api.InputPeerUser({
      userId: BigInt(uidCleanStr) as any,
      accessHash: BigInt(String(pInfo.accessHash).replace(/[^0-9-]/g, '')) as any
    });
    if ((client as any)._entityCache?.cacheMap) {
      (client as any)._entityCache.cacheMap.set(uidCleanStr, inputPeer);
    }
    return inputPeer;
  }

  // Level 0.5: Cloud Contact InputEntity resolution (Directly resolvable if saved in Telegram cloud contacts)
  try {
    const contactEntity = await client.getInputEntity(BigInt(uidCleanStr)).catch(() => null);
    if (contactEntity) {
      const safe = utils.getInputPeer(contactEntity);
      if (safe) return safe;
    }
  } catch {}

  // Fallback: If pInfo is missing or has neither username nor accessHash nor phone, search anywhere in system
  if (!pInfo || (!pInfo.accessHash && !pInfo.username && !pInfo.phone)) {
    const found = findPeerInfoAnywhere(uidCleanStr, accounts.get(phone)?.owner);
    if (found) {
      pInfo = { ...(pInfo || { userId: uidCleanStr }), ...found };
    }
  }

  const hashCleanStr = pInfo?.accessHash ? String(pInfo.accessHash).replace(/[^0-9-]/g, '') : '';

  // Level 1: Prioritize Username resolution (Telegram MTProto globally resolves fresh, session-valid InputPeer)
  if (pInfo?.username && pInfo.username.trim().length > 0) {
    const cleanUser = pInfo.username.trim().replace(/^@/, '');
    try {
      const inputEntity = await client.getInputEntity(`@${cleanUser}`).catch(() => null);
      if (inputEntity) {
        try {
          const safe = utils.getInputPeer(inputEntity);
          if (safe) {
            if ((safe as any).accessHash && pInfo) {
              pInfo.accessHash = String((safe as any).accessHash);
            }
            if ((client as any)._entityCache?.cacheMap) {
              (client as any)._entityCache.cacheMap.set(uidCleanStr, safe);
            }
            return safe;
          }
        } catch {}
      }
    } catch {}
    return `@${cleanUser}`;
  }

  // Level 2: GramJS client session lookup (User might already be cached in this client's session)
  try {
    const sessionPeer = (client as any).session?.getInputEntity(uid);
    if (sessionPeer) {
      try {
        const safe = utils.getInputPeer(sessionPeer);
        if (safe) return safe;
      } catch {}
    }
  } catch {}

  try {
    const cached = (client as any)._entityCache?.get?.(uidCleanStr);
    if (cached) {
      try {
        const safe = utils.getInputPeer(cached);
        if (safe) return safe;
      } catch {}
    }
  } catch {}

  // Level 3: Known accessHash (exact Telegram InputPeerUser)
  // Use account-specific hash if available, or fall back to global/extracted accessHash
  const effectiveHash = (pInfo?.accessHashes && pInfo.accessHashes[phone])
    ? String(pInfo.accessHashes[phone]).replace(/[^0-9-]/g, '')
    : (hashCleanStr || (pInfo?.accessHash ? String(pInfo.accessHash).replace(/[^0-9-]/g, '') : ''));

  if (effectiveHash && effectiveHash !== '0') {
    const inputPeer = new Api.InputPeerUser({
      userId: BigInt(uidCleanStr) as any,
      accessHash: BigInt(effectiveHash) as any
    });
    if ((client as any)._entityCache?.cacheMap) {
      (client as any)._entityCache.cacheMap.set(uidCleanStr, inputPeer);
    }
    // Background safety lock in contacts if not already secured
    lockContactPermanently(client, phone, uidCleanStr, pInfo).catch(() => null);
    return inputPeer;
  }

  // Level 3.5: Phone number contact import resolution (if user has phone number)
  if (pInfo?.phone && pInfo.phone.trim().length > 0) {
    try {
      const cleanPhone = pInfo.phone.replace(/[^0-9+]/g, '');
      if (cleanPhone.length >= 7) {
        const res: any = await client.invoke(new Api.contacts.ImportContacts({
          contacts: [new Api.InputPhoneContact({
            clientId: BigInt(uidCleanStr) as any,
            phone: cleanPhone,
            firstName: pInfo.firstName || 'User',
            lastName: pInfo.lastName || ''
          })]
        })).catch(() => null);
        if (res?.users && res.users.length > 0) {
          const safe = utils.getInputPeer(res.users[0]);
          if (safe) {
            if ((safe as any).accessHash && pInfo) {
              pInfo.accessHash = String((safe as any).accessHash);
            }
            if ((client as any)._entityCache?.cacheMap) {
              (client as any)._entityCache.cacheMap.set(uidCleanStr, safe);
            }
            return safe;
          }
        }
      }
    } catch {}
  }

  // Level 4: Active live voice call stream participants lookup
  for (const [_, act] of activeGroupCalls.entries()) {
    if (act?.call) {
      try {
        const partRes: any = await client.invoke(
          new Api.phone.GetGroupParticipants({
            call: act.call,
            ids: [],
            sources: [],
            offset: '',
            limit: 100
          })
        ).catch(() => null);

        if (partRes?.users && Array.isArray(partRes.users)) {
          recordUserPeers(phone, partRes.users, client);
          const found = partRes.users.find((u: any) => String(u.id) === uidCleanStr);
          if (found?.username) {
            return `@${found.username.replace(/^@/, '')}`;
          } else if (found?.accessHash && String(found.accessHash) !== '0') {
            return new Api.InputPeerUser({
              userId: BigInt(uidCleanStr) as any,
              accessHash: BigInt(found.accessHash.toString()) as any
            });
          }
        }
      } catch {}
    }

    if (act?.entity) {
      try {
        const partRes: any = await client.invoke(
          new Api.channels.GetParticipants({
            channel: act.entity,
            filter: new Api.ChannelParticipantsRecent(),
            offset: 0,
            limit: 200,
            hash: BigInt(0) as any
          })
        ).catch(() => null);

        if (partRes?.users && Array.isArray(partRes.users)) {
          recordUserPeers(phone, partRes.users, client);
          const found = partRes.users.find((u: any) => String(u.id) === uidCleanStr);
          if (found?.username) {
            return `@${found.username.replace(/^@/, '')}`;
          } else if (found?.accessHash && String(found.accessHash) !== '0') {
            return new Api.InputPeerUser({
              userId: BigInt(uidCleanStr) as any,
              accessHash: BigInt(found.accessHash.toString()) as any
            });
          }
        }
      } catch {}
    }
  }

  // Level 5: Try direct client.getInputEntity (strictly converting to InputPeer)
  try {
    const direct = await client.getInputEntity(uid).catch(() => null);
    if (direct) {
      try {
        const safe = utils.getInputPeer(direct);
        if (safe) return safe;
      } catch {}
    }
  } catch {}

  // Level 6: Expired Hash Auto-Recovery attempt
  const recovered = await recoverOrHealPeer(client, phone, accounts.get(phone)?.owner || 'admin', uid, pInfo);
  if (recovered) return recovered;

  // Fallback: If not resolvable to a valid InputPeer or username, return null so it can be skipped immediately with 0 delay
  return null;
}

