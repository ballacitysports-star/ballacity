import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "@react-email/components";
import type { TemplateEntry } from "./registry";

interface Props {
  accountName?: string;
  guardianName?: string;
  handoverUrl?: string;
  expiresDays?: number;
}

/**
 * Sent to the adult a managed account is being handed to (docs/managed-account-handover.md). Kind and plain: it says who
 * started it, what happens if the link is opened and what does not happen if it is not. It makes no claim about the law.
 */
const ManagedHandoverEmail = ({ accountName, guardianName, handoverUrl, expiresDays }: Props) => {
  const who = guardianName || "The person who manages your BallaCity account";
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Take over your BallaCity account and sign in yourself</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Your BallaCity account is ready to hand over</Heading>
          <Text style={text}>Hi,</Text>
          <Text style={text}>
            {who} has managed a BallaCity account for you{accountName ? ` (${accountName})` : ""}{" "}
            and has started handing it over, so you can sign in yourself with this email address.
          </Text>
          <Text style={text}>
            When you open the link you confirm it is you, then choose a password. After that the
            account is yours: your games, teams and videos stay as they are, and the person who
            managed it can no longer see it or change its settings.
          </Text>
          {handoverUrl ? (
            <Button style={button} href={handoverUrl}>
              Take over my account
            </Button>
          ) : null}
          <Text style={footer}>
            This link works once and expires in {expiresDays ?? 7} days. If you were not expecting
            this, or you do not want it, ignore this email: nothing changes unless you open the link
            and confirm.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  component: ManagedHandoverEmail,
  subject: (d: Record<string, unknown>) =>
    typeof d.guardianName === "string" && d.guardianName
      ? `${d.guardianName} is handing your BallaCity account over to you`
      : "Take over your BallaCity account",
  displayName: "Managed account handover",
  previewData: {
    accountName: "Jordan",
    guardianName: "Alex",
    handoverUrl: "https://ballacity.com/handover/example",
    expiresDays: 7,
  },
} satisfies TemplateEntry;

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" };
const container = { padding: "20px 25px" };
const h1 = { fontSize: "22px", fontWeight: "bold" as const, color: "#000000", margin: "0 0 20px" };
const text = { fontSize: "14px", color: "#55575d", lineHeight: "1.5", margin: "0 0 20px" };
const button = {
  backgroundColor: "#000000",
  color: "#ffffff",
  fontSize: "14px",
  borderRadius: "8px",
  padding: "12px 20px",
  textDecoration: "none",
};
const footer = { fontSize: "12px", color: "#999999", margin: "30px 0 0", lineHeight: "1.5" };
