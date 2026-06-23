import app from "./app.js";
import logger from "./logger.js";

const PORT = parseInt(process.env.PORT || "9090", 10);

app.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV || "development" }, "dcm-site-ui backend started");
});
