import { Router } from 'express';
import { getFullState } from '../store/index.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json(getFullState());
});

export default router;
