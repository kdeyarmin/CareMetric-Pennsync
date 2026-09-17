import gov.cms.hh.application.HHGrouper;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.LogManager;

/** Private stdin/stdout bridge. No network, claim files, or diagnostic records. */
class PennSyncHhgs {
    public static void main(String[] args) {
        PrintStream protocol = System.out;
        // CMS diagnostic/detail output must never enter the result protocol.
        System.setOut(new PrintStream(OutputStream.nullOutputStream()));
        System.setErr(new PrintStream(OutputStream.nullOutputStream()));
        LogManager.getLogManager().reset();
        try {
            if (Runtime.version().feature() != 17 || args.length != 0) {
                System.exit(2);
            }
            BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.US_ASCII));
            List<String> records = new ArrayList<>();
            String line;
            while ((line = input.readLine()) != null) {
                if (records.size() >= 1000 || line.length() != 600 || line.charAt(599) != ' '
                        || !line.chars().allMatch(c -> c >= 32 && c <= 126)) {
                    System.exit(2);
                }
                records.add(line);
            }
            if (records.isEmpty()) System.exit(2);
            List<String> results = new ArrayList<>();
            for (String record : records) {
                String result = HHGrouper.group(record);
                if (result == null || !result.matches("[0-9]{2}\\.[0-9]\\.[0-9]{2}[A-Z0-9]{5}[0-9]{4}")) {
                    System.exit(3);
                }
                results.add(result);
            }
            for (String result : results) protocol.println(result);
        } catch (Throwable failure) {
            // Neither CMS exceptions nor their messages are safe diagnostics.
            System.exit(3);
        }
    }
}
