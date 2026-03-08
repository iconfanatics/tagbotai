import React, { useState } from "react";
import Joyride, { CallBackProps, STATUS, Step } from "react-joyride";
import { useSubmit } from "react-router";

// Define the steps that point to the CSS selectors we'll add
const TOUR_STEPS: Step[] = [
  {
    target: "body",
    content: "Welcome to TagBot AI! Let's take a quick 3-step tour so you can start putting your customer segmentation on autopilot.",
    placement: "center",
    disableBeacon: true,
  },
  {
    target: ".tour-sync-btn",
    content: "Start here! After creating rules, you click 'Sync Customers' to scan your entire Shopify store and apply tags automatically.",
    placement: "bottom",
  },
  {
    target: ".tour-new-rule-btn",
    content: "This is where the magic happens. Create custom tags (like 'VIP' or 'At-Risk') based on exactly what customers buy or spend.",
    placement: "bottom",
  },
  {
    target: ".tour-view-rules-btn",
    content: "Once created, your rules live here. TagBot AI will run them automatically in the background on every new order!",
    placement: "bottom",
  }
];

export default function OnboardingTour() {
  const [run, setRun] = useState(true);
  const submit = useSubmit();

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status } = data;
    const finishedStatuses: string[] = [STATUS.FINISHED, STATUS.SKIPPED];

    // If the user clicks skip or finishes the last step, mark it in the DB so it never runs again
    if (finishedStatuses.includes(status)) {
      setRun(false);
      submit({ action: "complete_tour" }, { method: "post" });
    }
  };

  return (
    <Joyride
      steps={TOUR_STEPS}
      run={run}
      continuous
      scrollToFirstStep
      showProgress
      showSkipButton
      callback={handleJoyrideCallback}
      styles={{
        options: {
          primaryColor: "#4f46e5", // TagBot App Premium Gradient Purple
          textColor: "#111827",
          zIndex: 10000,
        },
        tooltipContainer: {
          textAlign: "left"
        },
        buttonNext: {
          borderRadius: '8px',
          fontWeight: 600
        },
        buttonBack: {
          color: "#4f46e5"
        }
      }}
    />
  );
}
