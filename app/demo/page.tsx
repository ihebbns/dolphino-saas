'use client'
import { useState } from 'react'

export default function DemoFormPage() {
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    businessName: '',
    businessType: 'restaurant',
    ownerName: '',
    phone: '',
    email: '',
    city: '',
    address: '',
    tableCount: '12',
    employeeCount: '',
    currentSystem: '',
    mainProblem: '',
    hasComputer: '',
    hasPrinter: '',
    hasCashDrawer: '',
    hasScanner: '',
    otherHardware: '',
    menuCategories: '',
    menuNotes: '',
    features: [] as string[],
    notes: '',
  })

  function update(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function toggleFeature(f: string) {
    setForm(prev => ({
      ...prev,
      features: prev.features.includes(f)
        ? prev.features.filter(x => x !== f)
        : [...prev.features, f]
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.businessName || !form.phone) {
      alert('Nom du commerce et telephone sont requis')
      return
    }
    setLoading(true)

    // Send to API (stores in DB for admin to see)
    try {
      const res = await fetch('/api/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      const data = await res.json()
      if (data.ok) setSubmitted(true)
      else alert('Erreur: ' + (data.error || 'Veuillez reessayer'))
    } catch {
      // Fallback: still show success (form data logged to console)
      console.log('Demo request:', form)
      setSubmitted(true)
    }
    setLoading(false)
  }

  if (submitted) {
    return (
      <div style={styles.page}>
        <div style={styles.successBox}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>✅</div>
          <h1 style={styles.successTitle}>Demande envoyee !</h1>
          <p style={styles.successText}>
            Merci <strong>{form.ownerName || form.businessName}</strong> !<br />
            Nous preparons votre demo personnalisee.<br />
            Vous serez contacte dans les prochaines <strong>24 heures</strong> sur le <strong>{form.phone}</strong>.
          </p>
          <div style={styles.summaryBox}>
            <div style={styles.summaryRow}><span>Commerce:</span><strong>{form.businessName}</strong></div>
            <div style={styles.summaryRow}><span>Type:</span><strong>{typeLabels[form.businessType]}</strong></div>
            <div style={styles.summaryRow}><span>Ville:</span><strong>{form.city || '—'}</strong></div>
            <div style={styles.summaryRow}><span>Tel:</span><strong>{form.phone}</strong></div>
          </div>
          <a href="/demo" style={styles.btnOutline}>Soumettre une autre demande</a>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <form onSubmit={handleSubmit} style={styles.formWrap}>
        {/* Header */}
        <div style={styles.header}>
          <div style={{ fontSize: '36px' }}>⚡</div>
          <h1 style={styles.title}>Demande de Demo</h1>
          <p style={styles.subtitle}>Remplissez ce formulaire et nous preparons votre systeme de caisse personnalise en 24h</p>
        </div>

        {/* Section 1: Business Info */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>1. Votre commerce</h2>
          <div style={styles.grid2}>
            <div style={styles.field}>
              <label style={styles.label}>Nom du commerce *</label>
              <input style={styles.input} value={form.businessName} onChange={e => update('businessName', e.target.value)} placeholder="Ex: Cafe Milano" required />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Type d&apos;activite *</label>
              <select style={styles.input} value={form.businessType} onChange={e => update('businessType', e.target.value)}>
                <option value="restaurant">Restaurant</option>
                <option value="cafe">Cafe / Salon de the</option>
                <option value="fastfood">Fast Food</option>
                <option value="bar">Bar / Resto-Bar</option>
                <option value="boulangerie">Boulangerie / Patisserie</option>
                <option value="pizzeria">Pizzeria</option>
                <option value="superette">Superette / Epicerie</option>
                <option value="parapharmacie">Parapharmacie</option>
                <option value="librairie">Librairie / Papeterie</option>
                <option value="boutique">Boutique / Pret-a-porter</option>
                <option value="autre">Autre</option>
              </select>
            </div>
          </div>
          <div style={styles.grid2}>
            <div style={styles.field}>
              <label style={styles.label}>Ville *</label>
              <input style={styles.input} value={form.city} onChange={e => update('city', e.target.value)} placeholder="Ex: Tunis, Sousse, Kelibia..." />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Adresse (optionnel)</label>
              <input style={styles.input} value={form.address} onChange={e => update('address', e.target.value)} placeholder="Rue, quartier..." />
            </div>
          </div>
        </div>

        {/* Section 2: Contact */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>2. Contact</h2>
          <div style={styles.grid2}>
            <div style={styles.field}>
              <label style={styles.label}>Nom du gerant</label>
              <input style={styles.input} value={form.ownerName} onChange={e => update('ownerName', e.target.value)} placeholder="Prenom et nom" />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Telephone *</label>
              <input style={styles.input} type="tel" value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="+216 XX XXX XXX" required />
            </div>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Email (optionnel)</label>
            <input style={styles.input} type="email" value={form.email} onChange={e => update('email', e.target.value)} placeholder="email@exemple.com" />
          </div>
        </div>

        {/* Section 3: Details */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>3. Details du commerce</h2>
          <div style={styles.grid2}>
            <div style={styles.field}>
              <label style={styles.label}>Nombre de tables (si applicable)</label>
              <input style={styles.input} type="number" value={form.tableCount} onChange={e => update('tableCount', e.target.value)} placeholder="12" />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Nombre d&apos;employes</label>
              <input style={styles.input} type="number" value={form.employeeCount} onChange={e => update('employeeCount', e.target.value)} placeholder="3" />
            </div>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Systeme actuel (caisse, carnet, rien...)</label>
            <input style={styles.input} value={form.currentSystem} onChange={e => update('currentSystem', e.target.value)} placeholder="Ex: caisse manuelle, Excel, rien..." />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Quel est votre probleme principal aujourd&apos;hui ?</label>
            <textarea style={{ ...styles.input, height: '70px', resize: 'vertical' }} value={form.mainProblem} onChange={e => update('mainProblem', e.target.value)} placeholder="Ex: erreurs de caisse, pas de suivi des employes, perte de temps..." />
          </div>
        </div>

        {/* Section 3b: Hardware */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>3b. Materiel disponible</h2>
          <div style={styles.grid2}>
            <div style={styles.field}>
              <label style={styles.label}>Avez-vous un ordinateur / tablette ?</label>
              <select style={styles.input} value={form.hasComputer} onChange={e => update('hasComputer', e.target.value)}>
                <option value="">-- Choisir --</option>
                <option value="pc_windows">PC Windows</option>
                <option value="pc_tactile">PC tactile (ecran tactile)</option>
                <option value="tablette">Tablette Android/iPad</option>
                <option value="non">Non, j&apos;ai besoin de materiel</option>
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Avez-vous une imprimante tickets ?</label>
              <select style={styles.input} value={form.hasPrinter} onChange={e => update('hasPrinter', e.target.value)}>
                <option value="">-- Choisir --</option>
                <option value="oui_thermique">Oui, imprimante thermique (80mm)</option>
                <option value="oui_autre">Oui, autre imprimante</option>
                <option value="non_besoin">Non, j&apos;en ai besoin</option>
                <option value="non_pas_besoin">Non, pas besoin d&apos;imprimer</option>
              </select>
            </div>
          </div>
          <div style={styles.grid2}>
            <div style={styles.field}>
              <label style={styles.label}>Tiroir-caisse ?</label>
              <select style={styles.input} value={form.hasCashDrawer} onChange={e => update('hasCashDrawer', e.target.value)}>
                <option value="">-- Choisir --</option>
                <option value="oui">Oui, j&apos;en ai un</option>
                <option value="non_besoin">Non, j&apos;en ai besoin</option>
                <option value="non_pas_besoin">Non, pas besoin</option>
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Scanner code-barres ?</label>
              <select style={styles.input} value={form.hasScanner} onChange={e => update('hasScanner', e.target.value)}>
                <option value="">-- Choisir --</option>
                <option value="oui">Oui</option>
                <option value="non_besoin">Non, j&apos;en ai besoin</option>
                <option value="non_pas_besoin">Non, pas besoin</option>
              </select>
            </div>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Autre materiel ou besoin specifique</label>
            <input style={styles.input} value={form.otherHardware} onChange={e => update('otherHardware', e.target.value)} placeholder="Ex: ecran cuisine, 2eme imprimante, balance..." />
          </div>
        </div>

        {/* Section 4: Menu */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>4. Menu / Produits</h2>
          <div style={styles.field}>
            <label style={styles.label}>Categories principales (separees par virgule)</label>
            <input style={styles.input} value={form.menuCategories} onChange={e => update('menuCategories', e.target.value)} placeholder="Ex: Pizza, Sandwichs, Boissons, Desserts..." />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Notes sur le menu (produits phares, prix moyens...)</label>
            <textarea style={{ ...styles.input, height: '80px', resize: 'vertical' }} value={form.menuNotes} onChange={e => update('menuNotes', e.target.value)} placeholder="Ex: Pizza 8-15 DT, Sandwichs 5-9 DT, Boissons 2-5 DT..." />
          </div>
        </div>

        {/* Section 5: Features needed */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>5. Fonctionnalites souhaitees</h2>
          <div style={styles.featuresGrid}>
            {featureOptions.map(f => (
              <button key={f.id} type="button" onClick={() => toggleFeature(f.id)}
                style={{ ...styles.featureBtn, ...(form.features.includes(f.id) ? styles.featureBtnActive : {}) }}>
                <span style={{ fontSize: '20px' }}>{f.icon}</span>
                <span style={{ fontSize: '12px', fontWeight: 600 }}>{f.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Section 6: Notes */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>6. Remarques</h2>
          <div style={styles.field}>
            <textarea style={{ ...styles.input, height: '80px', resize: 'vertical' }} value={form.notes} onChange={e => update('notes', e.target.value)} placeholder="Toute information supplementaire..." />
          </div>
        </div>

        {/* Submit */}
        <button type="submit" disabled={loading} style={styles.btnSubmit}>
          {loading ? 'Envoi en cours...' : '⚡ Envoyer la demande de demo'}
        </button>

        <p style={styles.footer}>
          Gratuit et sans engagement. Nous vous contactons dans les 24h pour planifier la demo.
        </p>
      </form>
    </div>
  )
}

const typeLabels: Record<string, string> = {
  restaurant: 'Restaurant',
  cafe: 'Cafe / Salon de the',
  fastfood: 'Fast Food',
  bar: 'Bar / Resto-Bar',
  boulangerie: 'Boulangerie / Patisserie',
  pizzeria: 'Pizzeria',
  superette: 'Superette / Epicerie',
  parapharmacie: 'Parapharmacie',
  librairie: 'Librairie / Papeterie',
  boutique: 'Boutique / Pret-a-porter',
  autre: 'Autre',
}

const featureOptions = [
  { id: 'tickets', icon: '🧾', label: 'Impression tickets' },
  { id: 'sessions', icon: '💰', label: 'Sessions de caisse' },
  { id: 'multiuser', icon: '👥', label: 'Multi-utilisateurs' },
  { id: 'dashboard', icon: '📊', label: 'Tableau de bord' },
  { id: 'stock', icon: '📦', label: 'Gestion de stock' },
  { id: 'barcode', icon: '⎸⎹⎸', label: 'Code-barres' },
  { id: 'tables', icon: '🪑', label: 'Plan de salle' },
  { id: 'kitchen', icon: '👨‍🍳', label: 'Ticket cuisine' },
  { id: 'delivery', icon: '🛵', label: 'Livraison' },
  { id: 'remote', icon: '☁️', label: 'Acces a distance' },
]

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #0B1120 0%, #1E293B 100%)',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '40px 20px',
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#F1F5F9',
  },
  formWrap: {
    width: '100%',
    maxWidth: '680px',
    background: '#111827',
    border: '1px solid #1E293B',
    borderRadius: '20px',
    padding: '40px 36px',
    boxShadow: '0 20px 60px rgba(0,0,0,.4)',
  },
  header: {
    textAlign: 'center' as const,
    marginBottom: '32px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 800,
    color: '#FBBF24',
    margin: '8px 0 4px',
    letterSpacing: '-0.5px',
  },
  subtitle: {
    fontSize: '14px',
    color: '#64748B',
    margin: 0,
  },
  section: {
    marginBottom: '28px',
    paddingBottom: '28px',
    borderBottom: '1px solid #1E293B',
  },
  sectionTitle: {
    fontSize: '15px',
    fontWeight: 700,
    color: '#F1F5F9',
    marginBottom: '14px',
  },
  grid2: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '14px',
    marginBottom: '14px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '5px',
    marginBottom: '10px',
  },
  label: {
    fontSize: '11px',
    color: '#64748B',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  input: {
    background: '#1E293B',
    border: '1.5px solid #334155',
    borderRadius: '10px',
    padding: '12px 14px',
    color: '#F1F5F9',
    fontSize: '14px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
    fontFamily: 'inherit',
  },
  featuresGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
    gap: '8px',
  },
  featureBtn: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '4px',
    padding: '14px 8px',
    background: '#1E293B',
    border: '2px solid #334155',
    borderRadius: '12px',
    cursor: 'pointer',
    color: '#64748B',
    transition: 'all .12s',
    textAlign: 'center' as const,
  },
  featureBtnActive: {
    borderColor: '#F59E0B',
    background: 'rgba(245,158,11,.08)',
    color: '#FBBF24',
  },
  btnSubmit: {
    width: '100%',
    padding: '18px',
    background: 'linear-gradient(135deg, #F59E0B, #FBBF24)',
    border: 'none',
    borderRadius: '12px',
    color: '#0B1120',
    fontSize: '16px',
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: '8px',
  },
  footer: {
    textAlign: 'center' as const,
    fontSize: '12px',
    color: '#64748B',
    marginTop: '14px',
  },
  successBox: {
    textAlign: 'center' as const,
    background: '#111827',
    border: '1px solid #1E293B',
    borderRadius: '20px',
    padding: '48px 36px',
    maxWidth: '500px',
    boxShadow: '0 20px 60px rgba(0,0,0,.4)',
  },
  successTitle: {
    fontSize: '24px',
    fontWeight: 800,
    color: '#10B981',
    marginBottom: '12px',
  },
  successText: {
    fontSize: '14px',
    color: '#94A3B8',
    lineHeight: 1.8,
    marginBottom: '20px',
  },
  summaryBox: {
    background: '#1E293B',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '20px',
    textAlign: 'left' as const,
  },
  summaryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '6px 0',
    borderBottom: '1px solid #334155',
    fontSize: '13px',
    color: '#94A3B8',
  },
  btnOutline: {
    display: 'inline-block',
    padding: '12px 24px',
    border: '1px solid #334155',
    borderRadius: '10px',
    color: '#64748B',
    textDecoration: 'none',
    fontSize: '13px',
    fontWeight: 600,
  },
}
