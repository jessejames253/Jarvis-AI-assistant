import { Router, type IRouter } from "express";
import healthRouter from "./health";
import searchRouter from "./search";

const router: IRouter = Router();

router.use(healthRouter);
router.use(searchRouter);

export default router;
