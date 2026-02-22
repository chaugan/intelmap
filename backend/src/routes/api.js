import { Router } from 'express';
import weatherRouter from './weather.js';
import webcamsRouter from './webcams.js';
import searchRouter from './search.js';
import aiRouter from './ai.js';
import stateRouter from './state.js';
import tilesRouter from './tiles.js';
import routeRouter from './route.js';
import authRouter from './auth.js';
import adminRouter from './admin.js';
import projectsRouter from './projects.js';
import groupsRouter from './groups.js';
import streetviewRouter from './streetview.js';
import avalancheWarningsRouter from './avalanche-warnings.js';
import aircraftRouter from './aircraft.js';

const router = Router();

router.use('/weather', weatherRouter);
router.use('/webcams', webcamsRouter);
router.use('/search', searchRouter);
router.use('/ai', aiRouter);
router.use('/state', stateRouter);
router.use('/tiles', tilesRouter);
router.use('/route', routeRouter);
router.use('/auth', authRouter);
router.use('/admin', adminRouter);
router.use('/projects', projectsRouter);
router.use('/groups', groupsRouter);
router.use('/streetview', streetviewRouter);
router.use('/avalanche-warnings', avalancheWarningsRouter);
router.use('/aircraft', aircraftRouter);

export default router;
