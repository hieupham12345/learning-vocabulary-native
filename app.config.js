import { config } from "dotenv";
import appJson from "./app.json";

config();

// Dev variant (EAS "development" profile sets APP_VARIANT=development) gets its own
// name + package + scheme so it installs alongside the production app on one device.
const IS_DEV = process.env.APP_VARIANT === "development";

export default ({ config: _config }) => ({
  ...appJson,
  expo: {
    ...appJson.expo,
    name: IS_DEV ? "Fast vocab (Dev)" : appJson.expo.name,
    scheme: IS_DEV ? "vocabappdev" : appJson.expo.scheme,
    android: {
      ...appJson.expo.android,
      package: IS_DEV ? "com.nhoczit111.vocabapp.dev" : appJson.expo.android.package,
    },
    extra: {
      ...appJson.expo.extra,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
    },
  },
});
