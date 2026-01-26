import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'dart:io';
import 'package:path_provider/path_provider.dart';
import 'whatsapp_api_service.dart';

class DocumentListScreen extends StatefulWidget {
  @override
  _DocumentListScreenState createState() => _DocumentListScreenState();
}

class _DocumentListScreenState extends State<DocumentListScreen> {
  final WhatsAppApiService _apiService = WhatsAppApiService();

  Future<void> _handleDownload(String url, String fileName) async {
    try {
      // Show loading indicator
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("Downloading $fileName...")),
      );

      final bytes = await _apiService.downloadFile(url);
      
      // Save to device
      final dir = await getApplicationDocumentsDirectory();
      final file = File('${dir.path}/$fileName');
      await file.writeAsBytes(bytes);

      // Success Message with "Open" action
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text("Download Complete!"),
          backgroundColor: Colors.green,
          action: SnackBarAction(
            label: "OPEN",
            textColor: Colors.white,
            onPressed: () => OpenFilex.open(file.path),
          ),
        ),
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("Error: $e"), backgroundColor: Colors.red),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text("Received Documents"),
        backgroundColor: Color(0xFF128C7E), // WhatsApp Green
        actions: [
          IconButton(
            icon: Icon(Icons.refresh),
            onPressed: () => setState(() {}),
          )
        ],
      ),
      body: FutureBuilder<List<dynamic>>(
        future: _apiService.getBlobList(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return Center(child: CircularProgressIndicator());
          } else if (snapshot.hasError || snapshot.data == null || snapshot.data!.isEmpty) {
            return _buildEmptyState();
          }

          return ListView.builder(
            padding: EdgeInsets.all(12),
            itemCount: snapshot.data!.length,
            itemBuilder: (context, index) {
              final item = snapshot.data![index];
              final String name = item['pathname'];
              final String url = item['url'];
              final String pin = name.split('.').first; // Extract PIN from filename

              return Card(
                elevation: 3,
                margin: EdgeInsets.symmetric(vertical: 8),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                child: ListTile(
                  contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  leading: CircleAvatar(
                    backgroundColor: Color(0xFF25D366).withOpacity(0.1),
                    child: Icon(Icons.description, color: Color(0xFF128C7E)),
                  ),
                  title: Text(
                    "Document #$pin",
                    style: TextStyle(fontWeight: FontWeight.bold),
                  ),
                  subtitle: Text(name),
                  trailing: ElevatedButton.icon(
                    onPressed: () => _handleDownload(url, name),
                    icon: Icon(Icons.download, size: 18),
                    label: Text("GET"),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Color(0xFF25D366),
                      foregroundColor: Colors.white,
                      shape: StadiumBorder(),
                    ),
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.cloud_off, size: 80, color: Colors.grey),
          SizedBox(height: 16),
          Text("No active files found", style: TextStyle(color: Colors.grey, fontSize: 18)),
          Text("Send a document to your bot first!", style: TextStyle(color: Colors.grey)),
        ],
      ),
    );
  }
}
