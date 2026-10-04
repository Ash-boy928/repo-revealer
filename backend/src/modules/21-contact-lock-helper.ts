// ---------------- CONTACT LOCK HELPER ----------------
async function lockContactPermanently(
  client: any,
  phone: string,
  uid: number | string,
  pInfo: any
): Promise<{ success: boolean; inputPeer?: any; error?: string }> {
  if (!client || !pInfo) return { success: false };
  const uidStr = String(uid).replace(/[^0-9-]/g, '');

  // Method 1: If phone number is present (7+ digits), import contact
  if (pInfo.phone && String(pInfo.phone).trim().length >= 7) {
    try {
      const cleanPhone = String(pInfo.phone).replace(/[^0-9+]/g, '');
      const res: any = await client.invoke(
        new Api.contacts.ImportContacts({
          contacts: [
            new Api.InputPhoneContact({
              clientId: BigInt(uidStr) as any,
              phone: cleanPhone,
              firstName: (pInfo.firstName || 'Member').slice(0, 30),
              lastName: (pInfo.lastName || '')
            })
          ]
        })
      ).catch(() => null);

      if (res && Array.isArray(res.users) && res.users.length > 0) {
        recordUserPeers(phone, res.users, client);
        const match = res.users.find((u: any) => String(u.id) === uidStr) || res.users[0];
        if (match && match.accessHash) {
          const permHash = String(match.accessHash);
          pInfo.accessHash = permHash;
          if (!pInfo.accessHashes) pInfo.accessHashes = {};
          pInfo.accessHashes[phone] = permHash;
          pInfo.isContactLocked = true;
          pInfo.contactSaved = true;
          savePeer(phone, uidStr, pInfo);
          const owner = accounts.get(phone)?.owner || 'admin';
          broadcastPeerToOwnerClients(owner, uidStr, pInfo);
          const inputPeer = new Api.InputPeerUser({
            userId: BigInt(uidStr) as any,
            accessHash: BigInt(permHash) as any
          });
          if ((client as any)._entityCache?.cacheMap) {
            (client as any)._entityCache.cacheMap.set(uidStr, inputPeer);
          }
          log(phone, 'OK', `📇 [PHONE CONTACT SAVED & LOCKED] ${pInfo.firstName || uidStr} saved to Telegram Contacts!`);
          return { success: true, inputPeer };
        }
        return { success: true };
      }
    } catch {}
  }

  // Method 2: Telegram Cloud Contact Save via contacts.AddContact (Works for live stream listeners without phone number or @username)
  const targetHash = (pInfo?.accessHashes && pInfo.accessHashes[phone]) || pInfo?.accessHash;
  if (targetHash && String(targetHash) !== '0') {
    try {
      const inputUser = new Api.InputUser({
        userId: BigInt(uidStr) as any,
        accessHash: BigInt(String(targetHash).replace(/[^0-9-]/g, '')) as any
      });
      const res: any = await client.invoke(
        new Api.contacts.AddContact({
          id: inputUser,
          firstName: (pInfo.firstName || 'User').slice(0, 30),
          lastName: (pInfo.lastName || '').slice(0, 30),
          phone: pInfo.phone || '',
          addPhonePrivacyException: false
        })
      ).catch(() => null);

      if (res) {
        let permHash = String(targetHash);
        if (res.users && Array.isArray(res.users) && res.users.length > 0) {
          const match = res.users.find((u: any) => String(u.id) === uidStr) || res.users[0];
          if (match && match.accessHash) {
            permHash = String(match.accessHash);
          }
          recordUserPeers(phone, res.users, client);
          try {
            if (client.session && typeof client.session.processEntities === 'function') {
              client.session.processEntities(res.users);
            }
            if ((client as any)._entityCache) {
              (client as any)._entityCache.add(res.users);
            }
          } catch {}
        }
        pInfo.accessHash = permHash;
        if (!pInfo.accessHashes) pInfo.accessHashes = {};
        pInfo.accessHashes[phone] = permHash;
        pInfo.isContactLocked = true;
        pInfo.contactSaved = true;
        savePeer(phone, uidStr, pInfo);
        const owner = accounts.get(phone)?.owner || 'admin';
        broadcastPeerToOwnerClients(owner, uidStr, pInfo);

        const inputPeer = new Api.InputPeerUser({
          userId: BigInt(uidStr) as any,
          accessHash: BigInt(permHash) as any
        });
        if ((client as any)._entityCache?.cacheMap) {
          (client as any)._entityCache.cacheMap.set(uidStr, inputPeer);
        }
        log(phone, 'OK', `📇 [CLOUD CONTACT SAVED & PERMANENT HASH LOCKED] ${pInfo.firstName || uidStr} secured in Telegram Contacts! (AccessHash: ${permHash})`);
        return { success: true, inputPeer };
      }
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  }

  return { success: false };
}

