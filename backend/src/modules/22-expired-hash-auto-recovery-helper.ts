// ---------------- EXPIRED HASH AUTO-RECOVERY HELPER ----------------
async function recoverOrHealPeer(
  client: any,
  phone: string,
  owner: string,
  uid: number | string,
  pInfo?: any
): Promise<any> {
  const uidStr = String(uid).replace(/[^0-9-]/g, '');

  // 1. If pInfo is already contact-locked and has accessHash, construct InputPeerUser directly!
  if (pInfo?.isContactLocked && pInfo?.accessHash && String(pInfo.accessHash) !== '0') {
    const inputPeer = new Api.InputPeerUser({
      userId: BigInt(uidStr) as any,
      accessHash: BigInt(String(pInfo.accessHash).replace(/[^0-9-]/g, '')) as any
    });
    if ((client as any)._entityCache?.cacheMap) {
      (client as any)._entityCache.cacheMap.set(uidStr, inputPeer);
    }
    return inputPeer;
  }

  // 2. Query Telegram Cloud Contacts list directly (contacts.GetContacts) to recover permanent access hash
  try {
    const contactsRes: any = await client.invoke(
      new Api.contacts.GetContacts({ hash: BigInt(0) as any })
    ).catch(() => null);

    if (contactsRes?.users && Array.isArray(contactsRes.users)) {
      recordUserPeers(phone, contactsRes.users, client);
      const match = contactsRes.users.find((u: any) => String(u.id) === uidStr);
      if (match && match.accessHash && String(match.accessHash) !== '0') {
        const permHash = String(match.accessHash);
        if (pInfo) {
          pInfo.accessHash = permHash;
          if (!pInfo.accessHashes) pInfo.accessHashes = {};
          pInfo.accessHashes[phone] = permHash;
          pInfo.isContactLocked = true;
          pInfo.contactSaved = true;
          savePeer(phone, uidStr, pInfo);
          broadcastPeerToOwnerClients(owner, uidStr, pInfo);
        }
        const inputPeer = new Api.InputPeerUser({
          userId: BigInt(uidStr) as any,
          accessHash: BigInt(permHash) as any
        });
        if ((client as any)._entityCache?.cacheMap) {
          (client as any)._entityCache.cacheMap.set(uidStr, inputPeer);
        }
        log(phone, 'OK', `🔄 [AUTO-RECOVERY SUCCESS] Recovered active contact access hash for ${pInfo?.firstName || uidStr} from Telegram Contacts!`);
        return inputPeer;
      }
    }
  } catch {}

  // 3. Heal from active live stream if stream is still ongoing
  try {
    const healed = await healPeerFromActiveLiveStream(client, phone, owner, Number(uidStr), pInfo);
    if (healed) {
      log(phone, 'OK', `🔄 [AUTO-RECOVERY SUCCESS] Healed access hash for ${pInfo?.firstName || uidStr} from live stream!`);
      // Lock into contacts immediately now that we have fresh hash
      lockContactPermanently(client, phone, uidStr, pInfo).catch(() => null);
      return healed;
    }
  } catch {}

  // 4. Cross-account lookup among all accounts of this owner
  const found = findPeerInfoAnywhere(uidStr, owner);
  if (found?.accessHash && String(found.accessHash) !== '0') {
    const crossPeer = new Api.InputPeerUser({
      userId: BigInt(uidStr) as any,
      accessHash: BigInt(String(found.accessHash).replace(/[^0-9-]/g, '')) as any
    });
    return crossPeer;
  }

  // 5. Try direct AddContact with any stored accessHash
  const anyHash = pInfo?.accessHash || (pInfo?.accessHashes && Object.values(pInfo.accessHashes)[0]);
  if (anyHash && String(anyHash) !== '0') {
    try {
      const lockRes = await lockContactPermanently(client, phone, uidStr, pInfo);
      if (lockRes.success && lockRes.inputPeer) {
        return lockRes.inputPeer;
      }
    } catch {}
  }

  return null;
}

