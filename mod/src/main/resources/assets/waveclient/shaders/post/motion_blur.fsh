#version 330

uniform sampler2D CurrentSampler;
uniform sampler2D HistorySampler;

layout(std140) uniform MotionBlurConfig {
    // x: how much of the kept image to blend in this frame (0 to 1)
    // y: 1.0 to blend in linear light
    vec4 Params;
};

out vec4 fragColor;

void main() {
    ivec2 pixel = ivec2(gl_FragCoord.xy);
    vec4 current = texelFetch(CurrentSampler, pixel, 0);
    vec3 cur = current.rgb;
    vec3 prev = texelFetch(HistorySampler, pixel, 0).rgb;
    float w = Params.x;
    vec3 blended = Params.y > 0.5 ? sqrt(mix(cur * cur, prev * prev, w)) : mix(cur, prev, w);

    // The kept image is 8-bit: a change smaller than half a step would round back to the old
    // value and leave a ghost forever. Always move at least one step toward the current frame
    // (never past it), then snap to the 8-bit grid. The quarter-step bias makes rounding and
    // truncating drivers store the same value.
    vec3 delta = cur - prev;
    vec3 change = max(abs(blended - prev), min(abs(delta), vec3(1.0 / 255.0)));
    vec3 result = prev + sign(delta) * change;
    fragColor = vec4((floor(result * 255.0 + 0.5) + 0.25) / 255.0, current.a);
}
