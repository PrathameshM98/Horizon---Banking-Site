"use client";

import React from "react";
import CountUp from "react-countup";

const AnimatedCounter = ({ amount }: { amount: number }) => {
  return (
    <div>
      <CountUp
        decimal="."
        prefix="$"
        duration={2.75}
        decimals={2}
        end={amount}
      />
    </div>
  );
};

export default AnimatedCounter;
