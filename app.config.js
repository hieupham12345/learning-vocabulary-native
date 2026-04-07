import { config } from "dotenv";
import appJson from "./app.json";

config();

export default ({ config: _config }) => ({
  ...appJson,
  expo: {
    ...appJson.expo,
    extra: {
      ...appJson.expo.extra,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
    },
  },
});
