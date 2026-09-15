import SwiftUI
import PhotosUI

// In-app capture (docs/step-6-plan.md Phase D): the sentence, an optional
// photo from the library or camera, an optional pasted link. Dictation is the
// keyboard's (decision 4). Save is disabled until there is a sentence
// (decision 3).
struct CaptureView: View {
    let onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var sentence = ""
    @State private var link = ""
    @State private var image: UIImage?
    @State private var picked: PhotosPickerItem?
    @State private var showCamera = false
    @State private var busy = false
    @State private var error: String?

    private var trimmed: String { sentence.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var linkURL: URL? {
        let text = link.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: text), ["http", "https"].contains(url.scheme?.lowercased()) else { return nil }
        return url
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("The idea") {
                    TextField("One sentence: what is it?", text: $sentence, axis: .vertical)
                        .lineLimit(2...6)
                }
                Section("Picture (optional)") {
                    if let image {
                        Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 200)
                        Button("Remove picture", role: .destructive) { self.image = nil; picked = nil }
                    } else {
                        PhotosPicker("Choose from library", selection: $picked, matching: .images)
                        if UIImagePickerController.isSourceTypeAvailable(.camera) {
                            Button("Take a photo") { showCamera = true }
                        }
                    }
                }
                Section("Link (optional)") {
                    HStack {
                        TextField("https://…", text: $link)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        PasteButton(payloadType: URL.self) { urls in
                            if let url = urls.first { link = url.absoluteString }
                        }
                        .labelStyle(.iconOnly)
                        .buttonBorderShape(.capsule)
                    }
                    if !link.isEmpty && linkURL == nil {
                        Text("Not a web link.").font(.footnote).foregroundStyle(.red)
                    }
                }
                Section {
                    Text("Saving runs extraction. That is one API call, about a cent.")
                        .font(.footnote).foregroundStyle(.secondary)
                    if let error { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("New idea")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: save) {
                        if busy { ProgressView() } else { Text("Save") }
                    }
                    .disabled(busy || trimmed.isEmpty || (!link.isEmpty && linkURL == nil))
                }
            }
            .onChange(of: picked) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self) {
                        image = UIImage(data: data)
                    }
                }
            }
            .fullScreenCover(isPresented: $showCamera) {
                CameraPicker { image = $0 }
                    .ignoresSafeArea()
            }
        }
    }

    private func save() {
        busy = true
        error = nil
        Task {
            do {
                try await Capture.save(sentence: trimmed, image: image, link: linkURL)
                onSaved()
                dismiss()
            } catch {
                self.error = error.localizedDescription
                busy = false
            }
        }
    }
}

// UIImagePickerController for the camera; PhotosPicker covers the library.
private struct CameraPicker: UIViewControllerRepresentable {
    let onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onImage(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}
