import { Router, type IRouter } from "express";
import healthRouter from "./health";
import searchRouter from "./search";
import chatRouter from "./chat";

const router: IRouter = Router();

router.use(healthRouter);
router.use(searchRouter);
router.use(chatRouter);

export default router;
