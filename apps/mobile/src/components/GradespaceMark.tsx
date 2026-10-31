import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

const SHAPES = [
  { d: "M363.2 166 A140 140 0 1 0 363.2 346", strokeWidth: 62 },
  { d: "M248 206 L304 256 L248 306", strokeWidth: 48 },
  { d: "M321 290h52a3 3 0 0 1 3 3v22a3 3 0 0 1-3 3h-52a3 3 0 0 1-3-3v-22a3 3 0 0 1 3-3z" },
] as const;

export function GradespaceMark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  return (
    <Svg accessibilityLabel="GS" height={props.height} width={props.height} viewBox="80 80 352 352">
      {SHAPES.map((shape) => (
        <ThemedPath
          key={shape.d}
          d={shape.d}
          color={props.color}
          colorClassName={props.colorClassName}
          {...("strokeWidth" in shape
            ? { fill: "none", stroke: "currentColor", strokeWidth: shape.strokeWidth }
            : { fill: "currentColor" })}
        />
      ))}
    </Svg>
  );
}
