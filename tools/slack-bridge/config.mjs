export const PAPERCLIP_CLI = "/opt/homebrew/bin/paperclipai";
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
      assigneeAgentId: "90795809-5964-4e33-bb71-0b866d832caf",
      notifyUserId: "U017DCMA1SS",
      webUrlBase: "http://100.81.141.101:3100/KOM/issues/",
    },
    // Channels where issue creation requires explicit :robot_face: reaction trigger.
    // For other channels, every new message creates an issue automatically.
    reactionTriggerChannels: ["C094A6LJMSM"], // #ntf-bistro-provoz
    triggerEmoji: "robot_face",
    watchChannels: [],
  },
  {
    name: "supersonic",
    appTokenEnv: "SLACK_APP_TOKEN_SUPERSONIC",
    botTokenEnv: "SLACK_BOT_TOKEN_SUPERSONIC",
    routing: "direct",
    channels: {
      "C0ATR2CRG0Y": {
        companyId: "a311a732-a9df-4fd7-ad0e-0b2cd6256606",
        projectId: "2ab41645-0cf9-4517-a3e4-b00891d05e99",
        assigneeAgentId: "14526586-5728-4a4a-b465-01bf28f32416",
        webUrlBase: "http://100.81.141.101:3100/MAJ/issues/",
      },
      "C0ASQCTDGLT": {
        companyId: "9e9efbb2-33d5-471f-90cb-9b9633d607be",
        projectId: "e17e003a-1adb-417a-87d6-6549f133c4f7",
        assigneeAgentId: "b45e7f49-53db-44bf-bb01-0b938c63ad72",
        webUrlBase: "http://100.81.141.101:3100/REJ/issues/",
      },
    },
    watchChannels: [],
  },
];
