// A signed-in teacher joins a school with the code its office gave them.
import { Router } from 'express';
import { z } from 'zod';
import { parse, limiter } from '../lib/util.js';
import { requireUser } from '../auth/session.js';
import { redeemCode } from '../services/teacher-codes.js';

export const router = Router();

const hour = 3_600_000;
// Guessing is slowed for each account and for each address.
const perPerson = limiter({ name: 'join', max: 8, windowMs: hour, key: (req) => req.user?.id });
const perAddress = limiter({ name: 'join-address', max: 30, windowMs: hour });

router.post('/join', requireUser, perPerson, perAddress, async (req, res) => {
  const { code } = parse(z.object({ code: z.string().trim().min(4).max(20) }), req.body);
  res.status(201).json(await redeemCode(code, req.user));
});
