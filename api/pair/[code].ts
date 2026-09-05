import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { getPairingSession, setPairingAnswer, addIceCandidate, updateSessionOffer } from '../../lib/store.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const parts = reqUrl.pathname.split('/').filter(Boolean);
  const code = parts[parts.length - 1] || reqUrl.searchParams.get('code') || '';

  if (!code) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Pairing code is required' }));
    return;
  }

  const session = await getPairingSession(code);
  if (!session) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Session not found or expired' }));
    return;
  }

  // GET: Retrieve offer or check answer (validates token if provided)
  if (req.method === 'GET') {
    const token = reqUrl.searchParams.get('token');
    if (token && token !== session.token) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Invalid session token' }));
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        code: session.code,
        token: session.token,
        offer: session.offer,
        offerCandidates: session.offerCandidates,
        answer: session.answer,
        answerCandidates: session.answerCandidates,
        expiresAt: session.expiresAt,
      })
    );
    return;
  }

  // PUT: Refresh desktop offer for existing persistent session
  if (req.method === 'PUT') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        if (!data.token || !data.offer) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Token and WebRTC SDP offer are required' }));
          return;
        }

        const updated = await updateSessionOffer(code, data.token, data.offer, data.candidates || []);
        if (!updated) {
          res.statusCode = 401;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Invalid token or session expired' }));
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            success: true,
            code: updated.code,
            token: updated.token,
            expiresAt: updated.expiresAt,
          })
        );
      } catch {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // POST: Submit answer from mobile
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        if (!data.answer) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'WebRTC SDP answer is required' }));
          return;
        }

        const success = await setPairingAnswer(code, data.answer, data.candidates || []);
        res.statusCode = success ? 200 : 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success }));
      } catch {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // PATCH: Add an ICE candidate
  if (req.method === 'PATCH') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const role = data.role === 'desktop' ? 'desktop' : 'mobile';
        if (!data.candidate) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Candidate is required' }));
          return;
        }

        const success = await addIceCandidate(code, role, data.candidate);
        res.statusCode = success ? 200 : 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success }));
      } catch {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  res.statusCode = 405;
  res.end();
}
