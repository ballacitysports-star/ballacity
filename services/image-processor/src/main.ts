/** Entry point of the container (see ../Dockerfile). Reads only IMAGE_PROCESSOR_* and PORT from the environment. */
import { configFromEnv, createImageProcessor } from "./server";

const config = configFromEnv(process.env);
const port = Number(process.env.PORT ?? 8080);
const server = createImageProcessor(config);
server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ msg: "image-processor listening", port }));
});
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
