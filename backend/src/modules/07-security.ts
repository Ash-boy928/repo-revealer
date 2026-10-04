// ---------------- SECURITY (HASHING) ----------------
function hashVal(plain        )         {
  return 'sha256:' + crypto.createHash('sha256').update(plain).digest('hex');
}

function verifyVal(stored        , plain        )          {
  if (stored && stored.startsWith('sha256:')) {
    return stored === hashVal(plain || '');
  }
  return stored === plain;
}

