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
  parentName?: string;
  childName?: string;
  teamName?: string;
  title?: string;
  when?: string;
  location?: string;
  tryoutUrl?: string;
  kind?: string;
  inviterName?: string;
}

const TryoutParentInviteEmail = ({
  parentName,
  childName,
  teamName,
  title,
  when,
  location,
  tryoutUrl,
  inviterName,
  kind,
}: Props) => {
  const team = teamName || "A team";
  const camp = kind === "clinic";
  const noun = camp ? "camp" : "tryout";
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`${team} invited ${childName || "your player"} to ${title || `a ${noun}`}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{title || (camp ? "Camp invite" : "Tryout invite")}</Heading>
          <Text style={text}>
            {parentName ? `Hi ${parentName}, ` : "Hi, "}
            {inviterName ? `${inviterName} from ` : ""}
            {team} invited {childName || "your player"}{" "}
            {camp ? "to join their camp on BallaCity." : "to try out on BallaCity."}
          </Text>
          {when ? (
            <Text style={detail}>
              <strong>When:</strong> {when}
            </Text>
          ) : null}
          {location ? (
            <Text style={detail}>
              <strong>Where:</strong> {location}
            </Text>
          ) : null}
          <Text style={text}>
            Create a free BallaCity parent account, add your child, and apply from the {noun} page.
          </Text>
          {tryoutUrl ? (
            <Button style={button} href={tryoutUrl}>
              View {noun} &amp; sign up
            </Button>
          ) : null}
          <Text style={footer}>
            You got this because a team manager entered your email. If it wasn't meant for you, you
            can ignore it.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  component: TryoutParentInviteEmail,
  subject: (d: Record<string, any>) =>
    `${d.teamName || "A team"} invited ${d.childName || "your player"} to ${d.title || (d.kind === "clinic" ? "a camp" : "a tryout")}`,
  displayName: "Tryout invite (new parent)",
  previewData: {
    parentName: "Sam",
    childName: "Jordan",
    teamName: "BallaCity",
    title: "BallaCity 14U Tryouts",
    when: "Sat, Oct 17, 2026, 10:00 AM EDT",
    location: "Bogan Park",
    tryoutUrl: "https://ballacity.com/tryouts/example",
    inviterName: "Coach D",
  },
} satisfies TemplateEntry;

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" };
const container = { padding: "20px 25px" };
const h1 = { fontSize: "22px", fontWeight: "bold" as const, color: "#000000", margin: "0 0 20px" };
const text = { fontSize: "14px", color: "#55575d", lineHeight: "1.5", margin: "0 0 20px" };
const detail = { fontSize: "15px", color: "#000000", lineHeight: "1.5", margin: "0 0 8px" };
const button = {
  backgroundColor: "#000000",
  color: "#ffffff",
  fontSize: "14px",
  borderRadius: "8px",
  padding: "12px 20px",
  textDecoration: "none",
};
const footer = { fontSize: "12px", color: "#999999", margin: "30px 0 0", lineHeight: "1.5" };
