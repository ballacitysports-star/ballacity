import * as React from "react";
import { Body, Button, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";

interface Props {
  playerName?: string;
  gameTitle?: string;
  amount?: string;
  method?: string;
  reviewUrl?: string;
}

const PaymentSubmittedEmail = ({ playerName, gameTitle, amount, method, reviewUrl }: Props) => {
  const who = playerName || "A player";
  const game = gameTitle || "your game";
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`${who} sent payment proof for ${game}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Payment proof to review</Heading>
          <Text style={text}>
            {who} says they paid for <strong>{game}</strong>. Check your {method || "payment"} app,
            then verify or decline it so their spot is confirmed.
          </Text>
          {amount ? <Text style={detail}><strong>Amount:</strong> {amount}</Text> : null}
          {method ? <Text style={detail}><strong>Method:</strong> {method}</Text> : null}
          {reviewUrl ? <Button style={button} href={reviewUrl}>Review payment</Button> : null}
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  component: PaymentSubmittedEmail,
  subject: (d: Record<string, any>) => `Payment to review: ${d.gameTitle || "your game"}`,
  displayName: "Payment proof submitted (host)",
  previewData: {
    playerName: "Jordan",
    gameTitle: "Balacity 5v5 Open Run",
    amount: "$10",
    method: "Venmo",
    reviewUrl: "https://ballacity.com/games/example",
  },
} satisfies TemplateEntry;

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" };
const container = { padding: "20px 25px" };
const h1 = { fontSize: "22px", fontWeight: "bold" as const, color: "#000000", margin: "0 0 20px" };
const text = { fontSize: "14px", color: "#55575d", lineHeight: "1.5", margin: "0 0 20px" };
const detail = { fontSize: "15px", color: "#000000", lineHeight: "1.5", margin: "0 0 8px" };
const button = {
  backgroundColor: "#000000", color: "#ffffff", fontSize: "14px", borderRadius: "8px",
  padding: "12px 20px", textDecoration: "none", marginTop: "12px",
};
