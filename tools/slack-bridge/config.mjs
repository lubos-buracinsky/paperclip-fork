export const PAPERCLIP_CLI = "/opt/homebrew/bin/paperclipai";
export const PAPERCLIP_API_URL = "http://127.0.0.1:3100/api";
export const POLL_INTERVAL_MS = 60_000;

export const WORKSPACES = [
  {
    name: "komfi",
    appTokenEnv: "SLACK_APP_TOKEN",
    botTokenEnv: "SLACK_BOT_TOKEN",
    routing: "triage",
    triage: {
      companyId: "a9d33dc4-ba89-4162-8550-178a7d639a7b",
      projectId: "8200d832-3101-4548-bb73-a3acc878bdaa",
      assigneeAgentId: "9a5b9dc6-068c-4702-b3ff-d97fb162c290",
      notifyUserId: "U017DCMA1SS",
      webUrlBase: "http://100.81.141.101:3100/KOM/issues/",
    },
    watchChannels: [],
  },
  // {
  //   name: "client-x",
  //   appTokenEnv: "SLACK_APP_TOKEN_CLIENTX",
  //   botTokenEnv: "SLACK_BOT_TOKEN_CLIENTX",
  //   routing: "direct",
  //   channels: {
  //     "C09GHIJKL": {
  //       companyId: "xxx",
  //       projectId: "yyy",
  //       assigneeAgentId: "zzz",
  //       notifyUserId: "UXXXXXXXXX",
  //       webUrlBase: "http://...",
  //     },
  //   },
  //   watchChannels: [],
  // },
];
