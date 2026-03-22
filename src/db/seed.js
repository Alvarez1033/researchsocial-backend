require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./pool');

async function seed() {
  const client = await pool.connect();
  console.log('🌱 Seeding database...');
  try {
    await client.query('BEGIN');

    // Create the superadmin
    const adminHash = await bcrypt.hash('admin123', 12);
    await client.query(`
      INSERT INTO users (handle, email, password_hash, name, color, initials, role, is_verified, email_verified, bio, affiliation)
      VALUES ('admin', 'admin@researchsocial.com', $1, 'Site Admin', '#818cf8', 'SA', 'superadmin', true, true, 'Platform administrator.', 'ResearchSocial')
      ON CONFLICT (email) DO NOTHING
    `, [adminHash]);

    // Create sample researchers
    const researchers = [
      { handle:'AlicePSY', email:'alice@example.com', name:'Dr. Alice Pemberton', title:'Associate Professor', affiliation:'MIT Brain & Cognitive Sciences', bio:'Cognitive neuroscientist studying sleep and memory.', color:'#818cf8', interests:['Sleep & Memory','EEG/fMRI','Open Science'] },
      { handle:'MarcusKBio', email:'marcus@example.com', name:'Marcus Kimura, PhD', title:'Senior Research Scientist', affiliation:'Broad Institute', bio:'Molecular biologist focused on CRISPR-Cas9 precision.', color:'#34d399', interests:['CRISPR/Cas9','iPSC Engineering','Gene Therapy'] },
      { handle:'SophiaLEcon', email:'sophia@example.com', name:'Sophia Laurent', title:'PhD Candidate', affiliation:'London School of Economics', bio:'Behavioral economist researching risk preferences under inflation.', color:'#f87171', interests:['Loss Aversion','Behavioral Finance','Prospect Theory'] },
      { handle:'DrJayaNeuro', email:'jaya@example.com', name:'Dr. Jaya Krishnamurthy', title:'Clinical Research Fellow', affiliation:'Johns Hopkins School of Medicine', bio:'Psychiatrist-scientist studying metacognition in anxiety disorders.', color:'#a78bfa', interests:['Anxiety Disorders','fMRI','Computational Psychiatry'] },
      { handle:'ElenaCLIM', email:'elena@example.com', name:'Elena Castillo, DrPH', title:'Research Director', affiliation:'Harvard T.H. Chan School of Public Health', bio:'Environmental epidemiologist specializing in climate-health intersections.', color:'#fbbf24', interests:['Climate & Health','Urban Heat Islands','Meta-analysis'] },
      { handle:'TaroMATH', email:'taro@example.com', name:'Taro Nakashima, PhD', title:'Computational Biologist', affiliation:'Wellcome Sanger Institute', bio:'Mathematician applying topological data analysis to genomics.', color:'#38bdf8', interests:['Topological Data Analysis','scRNA-seq','Bioinformatics'] },
      { handle:'PriyaDEV', email:'priya@example.com', name:'Priya Devkota, MSc', title:'Doctoral Researcher', affiliation:'University of Amsterdam', bio:'Developmental psychologist studying adolescent stress physiology.', color:'#4ade80', interests:['Adolescent Health','Null Results','Screen Time Research'] },
      { handle:'OmarFLING', email:'omar@example.com', name:'Omar Al-Farsi, MSc', title:'PhD Student', affiliation:'University of Edinburgh', bio:'Cross-cultural psychologist validating cognitive tools across languages.', color:'#fb923c', interests:['Cross-cultural Psychology','Psychometrics','Decision Making'] },
    ];

    const passwordHash = await bcrypt.hash('password123', 12);
    for (const r of researchers) {
      const initials = r.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      await client.query(`
        INSERT INTO users (handle, email, password_hash, name, title, affiliation, bio, color, initials, is_verified, email_verified, open_to_collab, interests, followers_count, papers_count, citations_count)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, true, true, $10, $11, $12, $13)
        ON CONFLICT (email) DO NOTHING
      `, [r.handle, r.email, passwordHash, r.name, r.title, r.affiliation, r.bio, r.color, initials, r.interests, Math.floor(Math.random()*2000)+100, Math.floor(Math.random()*50)+4, Math.floor(Math.random()*5000)+100]);
    }

    // Create sample tags
    const tags = [
      { name:'sleep', category:'Neuroscience', color:'#818cf8' },
      { name:'cognition', category:'Cognitive Science', color:'#34d399' },
      { name:'memory', category:'Neuroscience', color:'#818cf8' },
      { name:'EEG', category:'Methods', color:'#38bdf8' },
      { name:'longitudinal', category:'Methods', color:'#fbbf24' },
      { name:'genomics', category:'Molecular Biology', color:'#4ade80' },
      { name:'CRISPR', category:'Molecular Biology', color:'#34d399' },
      { name:'stem-cells', category:'Molecular Biology', color:'#4ade80' },
      { name:'behavioral-econ', category:'Economics', color:'#f87171' },
      { name:'loss-aversion', category:'Economics', color:'#f87171' },
      { name:'fMRI', category:'Methods', color:'#a78bfa' },
      { name:'anxiety', category:'Mental Health', color:'#f87171' },
      { name:'neuroscience', category:'Neuroscience', color:'#818cf8' },
      { name:'climate', category:'Environmental Health', color:'#fbbf24' },
      { name:'meta-analysis', category:'Methods', color:'#38bdf8' },
      { name:'scRNA-seq', category:'Bioinformatics', color:'#34d399' },
      { name:'bioinformatics', category:'Bioinformatics', color:'#38bdf8' },
      { name:'screen-time', category:'Public Health', color:'#fb923c' },
      { name:'null-result', category:'Open Science', color:'#8b949e' },
      { name:'cross-cultural', category:'Psychology', color:'#fb923c' },
      { name:'psychometrics', category:'Psychology', color:'#a78bfa' },
    ];

    for (const t of tags) {
      const slug = t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      await client.query(`
        INSERT INTO tags (name, slug, category, color, is_featured)
        VALUES ($1, $2, $3, $4, false)
        ON CONFLICT (slug) DO NOTHING
      `, [t.name, slug, t.category, t.color]);
    }

    // Create sample posts
    const posts = [
      { handle:'AlicePSY', type:'proposal', title:'Sleep Deprivation & Working Memory: A 6-Week Longitudinal Study', excerpt:'This proposal investigates the cumulative effects of chronic sleep restriction (≤6 hrs/night) on working memory capacity and attentional control. Using a within-subjects design with n=120 university students.', tags:['sleep','cognition','memory','EEG','longitudinal'] },
      { handle:'MarcusKBio', type:'findings', title:'CRISPR-Cas9 Off-Target Editing Rates in Pluripotent Stem Cells Revised', excerpt:'Our whole-genome sequencing of 48 iPSC lines edited with SpCas9 reveals a 3.2× lower off-target SNV rate than previously reported when guide RNA secondary structure is computationally optimized.', tags:['genomics','CRISPR','stem-cells'] },
      { handle:'SophiaLEcon', type:'study', title:'Loss Aversion Asymmetry Under Inflationary Pressure: Behavioral Field Study', excerpt:'Using a pre-registered field experiment with 3,400 participants across two economic regimes, we examine whether classical loss-aversion ratios (~2:1) hold under high inflation.', tags:['behavioral-econ','loss-aversion'] },
      { handle:'DrJayaNeuro', type:'proposal', title:'Neural Correlates of Metacognitive Accuracy in Anxiety Disorders', excerpt:'We propose examining fMRI BOLD responses in prefrontal cortex and anterior cingulate during metacognitive accuracy tasks in 80 participants (40 GAD, 40 controls).', tags:['anxiety','fMRI','neuroscience'] },
      { handle:'ElenaCLIM', type:'review', title:'Systematic Review: Urban Heat Island Effects on Pediatric Respiratory Health', excerpt:'Meta-analysis of 67 studies (n=2.1M, 2000–2024) quantifying the dose-response relationship between nighttime urban heat island intensity and pediatric asthma emergency visits.', tags:['climate','meta-analysis'] },
      { handle:'TaroMATH', type:'study', title:'Topological Data Analysis of Single-Cell RNA-seq Reveals Hidden Cell Lineages', excerpt:'Applying persistent homology to scRNA-seq data from 82,000 hematopoietic stem cells, we identify 3 previously undescribed progenitor sub-populations.', tags:['scRNA-seq','bioinformatics'] },
      { handle:'PriyaDEV', type:'findings', title:'Screen Time & Adolescent Cortisol: No Significant Effect After Confound Adjustment', excerpt:'Our pre-registered study (n=680, ages 13–17) finds no significant association between recreational screen time and salivary cortisol levels once covariates are included.', tags:['screen-time','null-result'] },
      { handle:'OmarFLING', type:'proposal', title:'Cross-Cultural Validation of the Cognitive Reflection Test in 14 Languages', excerpt:'We propose simultaneous administration to 7,200 participants across 14 linguistic-cultural groups to test for measurement invariance and predictive validity.', tags:['cross-cultural','psychometrics'] },
    ];

    for (const p of posts) {
      const userRes = await client.query('SELECT id FROM users WHERE handle = $1', [p.handle]);
      if (!userRes.rows.length) continue;
      const userId = userRes.rows[0].id;
      const postRes = await client.query(`
        INSERT INTO posts (author_id, type, status, title, excerpt, likes_count, comments_count)
        VALUES ($1, $2, 'approved', $3, $4, $5, $6)
        RETURNING id
      `, [userId, p.type, p.title, p.excerpt, Math.floor(Math.random()*400)+20, Math.floor(Math.random()*60)+5]);

      const postId = postRes.rows[0].id;
      for (const tagName of p.tags) {
        const tagRes = await client.query('SELECT id FROM tags WHERE slug = $1', [tagName.toLowerCase()]);
        if (tagRes.rows.length) {
          await client.query('INSERT INTO post_tags (post_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [postId, tagRes.rows[0].id]);
        }
      }
    }

    await client.query('COMMIT');
    console.log('✅ Seed complete!');
    console.log('\n📋 Test accounts:');
    console.log('   Admin:     admin@researchsocial.com / admin123');
    console.log('   Researcher: alice@example.com / password123');
    console.log('   (all 8 researchers use password: password123)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));
