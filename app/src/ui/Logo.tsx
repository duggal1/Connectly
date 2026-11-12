import React from 'react';
import Svg, { Path } from 'react-native-svg';

const LOGO_PATH = 'M0 0h32v32h-32zM192 0h128v32h-128zM480 0h32v32h-32zM0 32h96v32h-96zM192 32h128v32h-128zM416 32h96v32h-96zM0 64h128v32h-128zM192 64h128v32h-128zM384 64h128v32h-128zM0 96h192v32h-192zM224 96h32v32h-32zM320 96h192v32h-192zM64 128h160v32h-160zM256 128h192v32h-192zM128 160h32v32h-32zM192 160h128v32h-128zM352 160h32v32h-32zM160 192h192v32h-192zM96 224h320v32h-320zM32 256h224v32h-224zM288 256h192v32h-192zM0 288h160v32h-160zM192 288h96v32h-96zM352 288h160v32h-160zM0 320h128v32h-128zM192 320h128v32h-128zM384 320h128v32h-128zM0 352h64v32h-64zM192 352h128v32h-128zM448 352h64v32h-64zM192 384h128v32h-128zM192 416h128v32h-128zM192 448h128v32h-128zM192 480h128v32h-128z';

export function Logo({ size }: { size: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      shapeRendering="crispEdges"
      accessible
      accessibilityLabel="Connectly"
    >
      <Path fill="#1D4ED8" d={LOGO_PATH} />
    </Svg>
  );
}
