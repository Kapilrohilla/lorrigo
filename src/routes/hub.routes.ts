import { Router } from "express";
import { createHub, deleteHub, getHub, getSpecificHub, updateHub } from "../controllers/hub.controller";

const hubRouter = Router();

// @ts-ignore
hubRouter.post("/", createHub);

// @ts-ignore
hubRouter.get("/", getHub);

//@ts-ignore
hubRouter.get("/:id", getSpecificHub);

//@ts-ignore
hubRouter.put("/:id", updateHub);

//@ts-ignore
hubRouter.delete("/:id", deleteHub);
export default hubRouter;
