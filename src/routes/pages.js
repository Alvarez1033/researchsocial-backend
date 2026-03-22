// Express routes that serve the SPA HTML pages for client-side routing
const express = require('express');
const path = require('path');
const router = express.Router();
const pub = (...p) => path.join(__dirname, '../../public', ...p);

router.get('/profile/:handle', (req, res) => res.sendFile(pub('profile.html')));
router.get('/messages', (req, res) => res.sendFile(pub('messages.html')));
router.get('/messages/:id', (req, res) => res.sendFile(pub('messages.html')));
router.get('/notifications', (req, res) => res.sendFile(pub('notifications.html')));
router.get('/search', (req, res) => res.sendFile(pub('search.html')));
router.get('/network', (req, res) => res.sendFile(pub('network.html')));

module.exports = router;
