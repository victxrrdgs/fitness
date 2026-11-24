// Camada de dados: Firebase (Auth + Firestore) quando configurado, ou modo local (localStorage)
// para testes, com duas contas de teste para simular a dupla (abra duas abas).
//
// Onde fica cada coisa:
//   usuarios/{uid}/config/{prefs|plano}     privado
//   usuarios/{uid}/pesos/{data}             privado
//   perfis/{uid}                            nome, ofensiva e parceiros (a dupla lê)
//   feed/{uid}/dias/{data}                  registro do dia (a dupla lê e reage)
//   feed/{uid}/fotos/{id}                   fotos das refeições (a dupla lê)
//   convites/{codigo}                       código de dupla, validade curta
import { firebaseConfig } from './firebase-config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
export const modoLocal = !firebaseConfig || !firebaseConfig.apiKey || new URLSearchParams(location.search).has('local');
export const CONVITE_MIN = 30;

const novoCodigo = () => {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = new Uint8Array(6); crypto.getRandomValues(b);
  return Array.from(b, (x) => L[x % L.length]).join('');
};
const ehObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function mesclar(a, b) {
  const out = { ...(ehObj(a) ? a : {}) };
  for (const [k, v] of Object.entries(b)) out[k] = ehObj(v) && ehObj(out[k]) ? mesclar(out[k], v) : v;
  return out;
}

// ---------------- Modo local ----------------
function criarStoreLocal() {
  const KEY = 'fit-local-v1';
  const CONTAS = {
    eu: { uid: 'local-eu', displayName: 'Você (teste)', email: 'conta de teste 1', photoURL: '' },
    par: { uid: 'local-par', displayName: 'Parceira (teste)', email: 'conta de teste 2', photoURL: '' },
  };
  const ler = () => JSON.parse(localStorage.getItem(KEY) || '{}');
  const ouvintes = new Set();
  const avisar = () => ouvintes.forEach((f) => f());
  const gravar = (d) => { localStorage.setItem(KEY, JSON.stringify(d)); avisar(); };
  window.addEventListener('storage', (e) => { if (e.key === KEY) avisar(); });
  const novoId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const sessao = () => sessionStorage.getItem(KEY + '-conta') || localStorage.getItem(KEY + '-conta');
  let usuario = null;
  let onAuth = () => {};
  const colKey = (p) => p.join('/');
  const docOp = (p, fn) => {
    const d = ler(); const c = colKey(p.slice(0, -1)); const id = p.at(-1);
    d[c] = d[c] || {}; const r = fn(d[c][id]);
    if (r === undefined) delete d[c][id]; else d[c][id] = r;
    gravar(d);
  };
  const filtrar = (lista, onde) => (onde ? lista.filter((x) => x[onde[0]] === onde[2]) : lista);

  return {
    local: true,
    contasTeste: CONTAS,
    async init(cb) {
      onAuth = cb;
      const c = sessao();
      usuario = CONTAS[c] || null;
      cb(usuario);
    },
    async entrar(qual = 'eu') {
      sessionStorage.setItem(KEY + '-conta', qual); localStorage.setItem(KEY + '-conta', qual);
      usuario = CONTAS[qual]; onAuth(usuario);
    },
    async sair() { sessionStorage.removeItem(KEY + '-conta'); localStorage.removeItem(KEY + '-conta'); usuario = null; onAuth(null); },
    uid: () => usuario?.uid,
    novoId,
    assinarCol(p, cb, onde) {
      const emitir = () => cb(filtrar(Object.entries(ler()[colKey(p)] || {}).map(([id, v]) => ({ id, ...v })), onde));
      ouvintes.add(emitir); emitir();
      return () => ouvintes.delete(emitir);
    },
    assinarDoc(p, cb) {
      let ultimo;
      const emitir = () => {
        const v = (ler()[colKey(p.slice(0, -1))] || {})[p.at(-1)];
        const s = JSON.stringify(v ?? null);
        if (s !== ultimo) { ultimo = s; cb(v ? { id: p.at(-1), ...v } : null, { doServidor: true }); }
      };
      ouvintes.add(emitir); emitir();
      return () => ouvintes.delete(emitir);
    },
    assinarStatus(cb) { cb('Modo local de teste'); },
    async definir(p, dados, merge = true) { docOp(p, (atual) => (merge ? mesclar(atual, dados) : dados)); },
    async substituirCampos(p, dados) { docOp(p, (atual) => ({ ...(atual || {}), ...dados })); },
    async remover(p) { docOp(p, () => undefined); },
    async criarConvite(nome) {
      const cod = novoCodigo();
      await this.definir(['convites', cod], { uid: usuario.uid, nome, expira: Date.now() + CONVITE_MIN * 60000 }, false);
      return cod;
    },
    async usarConvite(cod) {
      const c = (ler().convites || {})[cod];
      if (!c || c.expira < Date.now()) throw new Error('Código inválido ou vencido.');
      if (c.uid === usuario.uid) throw new Error('Esse código é seu. Mande para a outra pessoa digitar.');
      docOp(['perfis', c.uid], (p) => ({ ...(p || {}), parceiros: [...new Set([...(p?.parceiros || []), usuario.uid])], convite: cod }));
      docOp(['perfis', usuario.uid], (p) => ({ ...(p || {}), parceiros: [...new Set([...(p?.parceiros || []), c.uid])] }));
      docOp(['convites', cod], () => undefined);
      return c;
    },
    async desfazerDupla(outro) {
      docOp(['perfis', usuario.uid], (p) => ({ ...(p || {}), parceiros: (p?.parceiros || []).filter((x) => x !== outro) }));
      docOp(['perfis', outro], (p) => (p ? { ...p, parceiros: (p.parceiros || []).filter((x) => x !== usuario.uid) } : undefined));
    },
    async exportarTudo() { return ler(); },
  };
}

// ---------------- Firebase ----------------
async function criarStoreFirebase() {
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(FB + 'firebase-app.js'),
    import(FB + 'firebase-auth.js'),
    import(FB + 'firebase-firestore.js'),
  ]);
  const app = initializeApp(firebaseConfig);
  const a = auth.getAuth(app);
  let db;
  try {
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch (e) {
    db = fs.getFirestore(app);
  }
  let uid = null;
  const ref = (p) => fs.doc(db, ...p);
  const col = (p) => fs.collection(db, ...p);
  const mapear = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  return {
    local: false,
    async init(cb) {
      try { await auth.getRedirectResult(a); } catch (e) { console.warn(e); }
      auth.onAuthStateChanged(a, (u) => { uid = u ? u.uid : null; cb(u); });
    },
    async entrar() {
      const prov = new auth.GoogleAuthProvider();
      prov.setCustomParameters({ prompt: 'select_account' });
      try {
        await auth.signInWithPopup(a, prov);
      } catch (e) {
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
          await auth.signInWithRedirect(a, prov);
        } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
          throw e;
        }
      }
    },
    async sair() { await auth.signOut(a); },
    uid: () => uid,
    novoId: () => fs.doc(fs.collection(db, '_')).id,
    assinarCol(p, cb, onde) {
      const q = onde ? fs.query(col(p), fs.where(...onde)) : col(p);
      return fs.onSnapshot(q, (s) => cb(mapear(s)), (e) => console.error(p.join('/'), e));
    },
    assinarDoc(p, cb) {
      // doServidor = false quando o documento "não existe" só porque o cache local ainda está vazio (offline).
      return fs.onSnapshot(ref(p), { includeMetadataChanges: true }, (s) => cb(s.exists() ? { id: s.id, ...s.data() } : null, { doServidor: !s.metadata.fromCache }), (e) => console.error(p.join('/'), e));
    },
    assinarStatus(cb) {
      const at = () => cb(navigator.onLine ? 'Sincronizado' : 'Offline');
      window.addEventListener('online', at); window.addEventListener('offline', at); at();
    },
    // Gravações não são aguardadas: funcionam offline e sincronizam depois.
    // Se o servidor recusar (regras), avisa quem chamou por onErro.
    onErro: null,
    async definir(p, dados, merge = true) { fs.setDoc(ref(p), dados, { merge }).catch((e) => this.onErro?.(e, p)); },
    // Grava só estes campos, substituindo cada um por inteiro.
    async substituirCampos(p, dados) { fs.setDoc(ref(p), dados, { mergeFields: Object.keys(dados) }).catch((e) => this.onErro?.(e, p)); },
    async remover(p) { fs.deleteDoc(ref(p)).catch((e) => this.onErro?.(e, p)); },
    async criarConvite(nome) {
      const cod = novoCodigo();
      await fs.setDoc(ref(['convites', cod]), { uid, nome, expira: Date.now() + CONVITE_MIN * 60000 });
      return cod;
    },
    // Quem digita o código entra na lista de parceiros de quem gerou (as regras conferem o código)
    // e coloca essa pessoa na própria lista.
    async usarConvite(cod) {
      const s = await fs.getDoc(ref(['convites', cod]));
      const c = s.exists() ? s.data() : null;
      if (!c || c.expira < Date.now()) throw new Error('Código inválido ou vencido.');
      if (c.uid === uid) throw new Error('Esse código é seu. Mande para a outra pessoa digitar.');
      await fs.updateDoc(ref(['perfis', c.uid]), { parceiros: fs.arrayUnion(uid), convite: cod });
      await fs.setDoc(ref(['perfis', uid]), { parceiros: fs.arrayUnion(c.uid) }, { merge: true });
      fs.deleteDoc(ref(['convites', cod])).catch(() => {});
      return c;
    },
    // Tira a outra pessoa da minha lista e me tira da lista dela (as regras deixam só se retirar).
    async desfazerDupla(outro) {
      await fs.updateDoc(ref(['perfis', uid]), { parceiros: fs.arrayRemove(outro) });
      await fs.updateDoc(ref(['perfis', outro]), { parceiros: fs.arrayRemove(uid) }).catch(() => {});
    },
    async exportarTudo() {
      const out = {};
      for (const c of ['config', 'pesos']) out[c] = mapear(await fs.getDocs(col(['usuarios', uid, c])));
      for (const c of ['dias', 'fotos']) out[c] = mapear(await fs.getDocs(col(['feed', uid, c])));
      const p = await fs.getDoc(ref(['perfis', uid]));
      out.perfil = p.exists() ? p.data() : null;
      return out;
    },
  };
}

export async function criarStore() {
  return modoLocal ? criarStoreLocal() : criarStoreFirebase();
}
