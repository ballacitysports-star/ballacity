import * as React from "react";
import { Body, Button, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";

interface Props {
  childName?: string;
  parentName?: string;
  approvalUrl?: string;
  expiresHours?: number;
}

const GuardianApprovalEmail = ({ childName, parentName, approvalUrl, expiresHours }: Props) => {
  const who = childName || "Your child";
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{who} asked you to approve their ballaCity account</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Approve a ballaCity account</Heading>
          <Text style={text}>{parentName ? `Hi ${parentName},` : "Hi,"}</Text>
          <Text style={text}>
            {who} is signing up for ballaCity and named you as their parent or guardian. Their
            account stays limited — no messages, videos or public profile — until you approve it.
          </Text>
          {approvalUrl ? (
            <Button style={button} href={approvalUrl}>
              Review and approve
            </Button>
          ) : null}
          <Text style={footer}>
            You'll sign in with your own adult ballaCity account to approve. This one-time link
            expires in {expiresHours ?? 72} hours. If you don't know who sent this, you can safely
            ignore it.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  component: GuardianApprovalEmail,
  subject: (d: Record<string, any>) =>
    d.childName
      ? `${d.childName} asked you to approve their ballaCity account`
      : "Approve a ballaCity account",
  displayName: "Guardian approval request",
  previewData: {
    childName: "Jordan",
    parentName: "Alex",
    approvalUrl: "https://ballacity.com/parent/consent/example",
    expiresHours: 72,
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
