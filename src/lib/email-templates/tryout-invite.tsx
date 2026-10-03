import * as React from "react";
import { Body, Button, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";

interface Props {
  playerName?: string;
  teamName?: string;
  title?: string;
  when?: string;
  location?: string;
  mapsUrl?: string;
  tryoutUrl?: string;
  byGuardian?: boolean;
}

const TryoutInviteEmail = ({ playerName, teamName, title, when, location, mapsUrl, tryoutUrl, byGuardian }: Props) => {
  const team = teamName || "the team";
  const who = playerName || "your player";
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`You're invited: ${title || "tryout"} with ${team}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{title || "Tryout invite"}</Heading>
          <Text style={text}>
            {byGuardian
              ? `Thanks for applying for ${who}. ${team} is expecting you at the tryout.`
              : `Thanks for applying. ${team} is expecting you at the tryout.`}
          </Text>
          {when ? <Text style={detail}><strong>When:</strong> {when}</Text> : null}
          {location ? <Text style={detail}><strong>Where:</strong> {location}</Text> : null}
          {mapsUrl ? (
            <Button style={button} href={mapsUrl}>Get directions</Button>
          ) : null}
          {tryoutUrl ? (
            <Text style={footer}>
              See the details or cancel your spot: {tryoutUrl}
            </Text>
          ) : null}
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  component: TryoutInviteEmail,
  subject: (d: Record<string, any>) => `Tryout invite: ${d.title || "tryout"}${d.when ? ` — ${d.when}` : ""}`,
  displayName: "Tryout invite",
  previewData: {
    playerName: "Jordan",
    teamName: "Balacity",
    title: "BallaCity 14U Baseball Tryouts",
    when: "Sat, Oct 17, 2026, 10:00 AM",
    location: "Bogan Park",
    mapsUrl: "https://www.google.com/maps/search/?api=1&query=Bogan%20Park",
    tryoutUrl: "https://ballacity.com/tryouts/example",
    byGuardian: true,
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
const footer = { fontSize: "12px", color: "#999999", margin: "30px 0 0", lineHeight: "1.5" };
