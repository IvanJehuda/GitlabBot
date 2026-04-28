const express = require('express');
const userMapping = require('./user-mapping.json');

const app = express();
app.use(express.json({ limit: '5mb' }));

const PORT = process.env.PORT || 3000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const GITLAB_SECRET_TOKEN = process.env.GITLAB_SECRET_TOKEN;

if (!DISCORD_WEBHOOK_URL) {
  console.error('ERROR: DISCORD_WEBHOOK_URL belum di-set di environment variable');
  process.exit(1);
}

// Health check
app.get('/', (req, res) => {
  res.send('GitLab → Discord bot is running 🚀');
});

// GitLab webhook endpoint
app.post('/webhook/gitlab', async (req, res) => {
  // Verifikasi secret token (security)
  const token = req.headers['x-gitlab-token'];
  if (GITLAB_SECRET_TOKEN && token !== GITLAB_SECRET_TOKEN) {
    console.warn('Token mismatch, request ditolak');
    return res.status(401).send('Unauthorized');
  }

  const event = req.headers['x-gitlab-event'];
  const payload = req.body;

  // Hanya proses Merge Request events
  if (event !== 'Merge Request Hook') {
    return res.status(200).send('Event diabaikan');
  }

  const action = payload.object_attributes?.action;
  const reviewers = payload.reviewers || [];

  // Hanya kirim notif kalo:
  // 1. MR baru dibuka DAN udah ada reviewer-nya, ATAU
  // 2. Reviewer baru di-assign ke MR yang udah ada
  const shouldNotify =
    (action === 'open' && reviewers.length > 0) ||
    action === 'reviewer_updated' ||
    action === 'update'; // beberapa versi GitLab pakai 'update' utk reviewer change

  if (!shouldNotify || reviewers.length === 0) {
    return res.status(200).send('Tidak ada reviewer untuk di-notify');
  }

  try {
    await sendDiscordNotification(payload, reviewers);
    res.status(200).send('Notifikasi terkirim');
  } catch (error) {
    console.error('Error kirim notif:', error);
    res.status(500).send('Gagal kirim notifikasi');
  }
});

// Variasi pesan biar gak boring
const messageVariations = [
  '{mentions} bang tolong bang, review MR ku bang 🙏',
  '{mentions} mainkan bang tolong hehehe 😎',
  '{mentions} halo kak, ada titipan MR nih, dicek ya kakk 🥺',
  '{mentions} permisi suhu, mohon pencerahannya di MR ini 🙇',
  '{mentions} ASSEMBLE! ada MR yang butuh disentuh tangan dinginmu ⚔️',
  '{mentions} psst.. ada MR baru nih, jangan lupa direview ya 👀',
  '{mentions} woi review dong, jangan php in ku 😤',
  '{mentions} PPL gak akan jalan kalo MR-nya gak di-review loh 😔🙏',
  '{mentions} tolong bang please bang, satu MR aja bang 😩',
  '{mentions} dengan hormat, mohon kesediaannya untuk mereview MR berikut 🎩',
  '{mentions} oi reviewer, ngopi dulu trus review MR ku ya ☕',
  '{mentions} ding ding! reviewer dipanggil ke meja MR 🛎️',
  '{mentions} sebelum deadline mepet, yuk direview dulu MR nya 🏃💨',
  '{mentions} ada notif penting nih buat kamu, jangan di-skip yaa ✨',
  '{mentions} GASKEUN review MR baru 🔥🔥🔥',
];

function getRandomMessage(mentions) {
  const template = messageVariations[Math.floor(Math.random() * messageVariations.length)];
  return template.replace('{mentions}', mentions);
}

async function sendDiscordNotification(payload, reviewers) {
  const mr = payload.object_attributes;
  const author = payload.user;
  const project = payload.project;

  // Map GitLab username ke Discord user ID
  const mentions = reviewers
    .map(r => {
      const discordId = userMapping[r.username];
      if (!discordId) {
        console.warn(`Tidak ada mapping untuk GitLab user: ${r.username}`);
        return `**${r.name}** (belum di-map)`;
      }
      return `<@${discordId}>`;
    })
    .join(' ');

  const message = {
    content: getRandomMessage(mentions),
    embeds: [
      {
        title: `MR !${mr.iid}: ${mr.title}`,
        url: mr.url,
        description: mr.description?.slice(0, 300) || '_(no description)_',
        color: 0xfc6d26, // Warna oranye GitLab
        fields: [
          { name: 'Author', value: author.name, inline: true },
          { name: 'Project', value: project.name, inline: true },
          { name: 'Branch', value: `\`${mr.source_branch}\` → \`${mr.target_branch}\``, inline: false },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };

  const response = await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord webhook error: ${response.status} - ${text}`);
  }

  console.log(`Notif terkirim untuk MR !${mr.iid}, reviewer: ${reviewers.map(r => r.username).join(', ')}`);
}

app.listen(PORT, () => {
  console.log(`Server jalan di port ${PORT}`);
});
