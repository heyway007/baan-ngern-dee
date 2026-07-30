import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProfileAvatar } from "./profile-avatar";

describe("ProfileAvatar", () => {
  it("renders the profile image with an accessible name", () => {
    render(
      <ProfileAvatar
        displayName="มิน"
        url="https://example.test/avatar.webp"
      />
    );

    expect(
      screen.getByRole("img", { name: "รูปโปรไฟล์ของ มิน" })
    ).toHaveAttribute("src", "https://example.test/avatar.webp");
  });

  it("uses the first non-space character when no image is available", () => {
    render(<ProfileAvatar displayName="  มิน" url={null} />);

    expect(
      screen.getByRole("img", { name: "รูปโปรไฟล์ของ มิน" })
    ).toHaveTextContent("ม");
  });

  it("hides a broken image and restores the display-name initial", () => {
    render(
      <ProfileAvatar
        displayName=" มิน"
        url="https://example.test/broken.webp"
      />
    );

    fireEvent.error(
      screen.getByRole("img", { name: "รูปโปรไฟล์ของ มิน" })
    );

    expect(
      screen.getByRole("img", { name: "รูปโปรไฟล์ของ มิน" })
    ).toHaveTextContent("ม");
    expect(screen.queryByAltText("รูปโปรไฟล์ของ มิน")).toBeNull();
  });
});
