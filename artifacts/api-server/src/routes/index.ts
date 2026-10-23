import { Router, type IRouter } from "express";
import healthRouter from "./health";
import energyRouter from "./energy";

const router: IRouter = Router();

router.use(healthRouter);
router.use(energyRouter);

export default router;
