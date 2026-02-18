import { Router } from 'express';
import weatherRouter from './weather.js';
import webcamsRouter from './webcams.js';
import searchRouter from './search.js';
import aiRouter from './ai.js';
import stateRouter from './state.js';
import tilesRouter from './tiles.js';
import routeRouter from './route.js';

const router = Router();

router.use('/weather', weatherRouter);
router.use('/webcams', webcamsRouter);
router.use('/search', searchRouter);
router.use('/ai', aiRouter);
router.use('/state', stateRouter);
router.use('/tiles', tilesRouter);
router.use('/route', routeRouter);

export default router;
